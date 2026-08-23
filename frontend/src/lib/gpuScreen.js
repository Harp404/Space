/**
 * GPU conjunction screening.        frontend/src/lib/gpuScreen.js
 * ============================================================================
 * WHAT THIS IS
 *
 * The all-pairs part of conjunction screening — the O(N²) sweep every
 * screening system has to do before anything clever happens — run as a WebGPU
 * compute shader on whatever GPU the viewing machine has.
 *
 * For ~31,000 tracked objects that is ~480 MILLION pairs. Each pair gets a
 * closest-point-of-approach solve over the coming hour, assuming straight-line
 * relative motion. One thread per object, each sweeping the objects after it.
 *
 * WHAT IT HONESTLY IS AND IS NOT
 *
 *   IS   the standard coarse filter: linear CPA on real SGP4 states, the same
 *        first pass real screening pipelines use to cut the pair count down
 *   NOT  a precision screen. Linear relative motion over an hour is wrong for
 *        exactly the co-orbital slow approaches, so candidates below the gate
 *        threshold are re-screened with full SGP4 on the gateway. The verdict
 *        never comes from this pass — it produces CANDIDATES and a throughput
 *        number, and the gate does its own work.
 *
 * Degrades to null when WebGPU is absent; nothing depends on it existing.
 * ============================================================================
 */

const WGSL = /* wgsl */ `
struct Params {
  n: u32,
  window_s: f32,
  threshold_km: f32,
  _pad: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> states: array<f32>;      // 6 per object
@group(0) @binding(2) var<storage, read_write> hits: array<f32>;  // 4 per slot: i, j, dmin, tmin
@group(0) @binding(3) var<storage, read_write> counters: array<atomic<u32>>; // [candidates, pairs_lo, pairs_hi]

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let n = params.n;
  if (i >= n) { return; }
  let pi = vec3<f32>(states[i*6u], states[i*6u+1u], states[i*6u+2u]);
  let vi = vec3<f32>(states[i*6u+3u], states[i*6u+4u], states[i*6u+5u]);

  var checked: u32 = 0u;
  for (var j: u32 = i + 1u; j < n; j = j + 1u) {
    let dp = vec3<f32>(states[j*6u], states[j*6u+1u], states[j*6u+2u]) - pi;
    // quick reject: farther apart than an hour of closing at 16 km/s can cover
    let d0 = length(dp);
    checked = checked + 1u;
    if (d0 > 16.0 * params.window_s + params.threshold_km) { continue; }
    let dv = vec3<f32>(states[j*6u+3u], states[j*6u+4u], states[j*6u+5u]) - vi;
    let dv2 = dot(dv, dv);
    var tc: f32 = 0.0;
    if (dv2 > 1e-12) { tc = clamp(-dot(dp, dv) / dv2, 0.0, params.window_s); }
    let dmin = length(dp + dv * tc);
    if (dmin < params.threshold_km) {
      let slot = atomicAdd(&counters[0], 1u);
      if (slot < 4096u) {
        hits[slot*4u]      = f32(i);
        hits[slot*4u + 1u] = f32(j);
        hits[slot*4u + 2u] = dmin;
        hits[slot*4u + 3u] = tc;
      }
    }
  }
  // 64-bit pair counter out of two u32s — 480M overflows nothing, but be exact
  let lo = atomicAdd(&counters[1], checked);
  if (lo + checked < lo) { atomicAdd(&counters[2], 1u); }
}
`

export async function gpuScreen({ ids, names, states }, { windowS = 3600, thresholdKm = 25 } = {}) {
  if (!navigator.gpu) return { supported: false, reason: 'WebGPU is not available in this browser' }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return { supported: false, reason: 'no GPU adapter' }
  const device = await adapter.requestDevice()
  const n = ids.length

  const mkBuf = (size, usage) => device.createBuffer({ size, usage })
  const stateBuf = mkBuf(states.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
  device.queue.writeBuffer(stateBuf, 0, states)
  const hitsBuf = mkBuf(4096 * 4 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
  const cntBuf = mkBuf(3 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST)
  device.queue.writeBuffer(cntBuf, 0, new Uint32Array([0, 0, 0]))
  const uni = mkBuf(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  device.queue.writeBuffer(uni, 0, new Uint32Array([n]))
  device.queue.writeBuffer(uni, 4, new Float32Array([windowS, thresholdKm, 0]))

  const module = device.createShaderModule({ code: WGSL })
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uni } },
      { binding: 1, resource: { buffer: stateBuf } },
      { binding: 2, resource: { buffer: hitsBuf } },
      { binding: 3, resource: { buffer: cntBuf } },
    ],
  })

  const readHits = mkBuf(4096 * 4 * 4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
  const readCnt = mkBuf(3 * 4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)

  const t0 = performance.now()
  const enc = device.createCommandEncoder()
  const pass = enc.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bind)
  pass.dispatchWorkgroups(Math.ceil(n / 64))
  pass.end()
  enc.copyBufferToBuffer(hitsBuf, 0, readHits, 0, 4096 * 4 * 4)
  enc.copyBufferToBuffer(cntBuf, 0, readCnt, 0, 12)
  device.queue.submit([enc.finish()])
  await device.queue.onSubmittedWorkDone()
  const ms = performance.now() - t0

  await readCnt.mapAsync(GPUMapMode.READ)
  const [cand, pairsLo, pairsHi] = new Uint32Array(readCnt.getMappedRange().slice(0))
  readCnt.unmap()
  await readHits.mapAsync(GPUMapMode.READ)
  const raw = new Float32Array(readHits.getMappedRange().slice(0))
  readHits.unmap()

  const pairs = pairsHi * 2 ** 32 + pairsLo
  const found = Math.min(cand, 4096)
  const candidates = []
  for (let k = 0; k < found; k++) {
    const i = raw[k * 4], j = raw[k * 4 + 1]
    candidates.push({
      a: ids[i], b: ids[j],
      aName: names[i], bName: names[j],
      dmin_km: +raw[k * 4 + 2].toFixed(3),
      t_min_s: Math.round(raw[k * 4 + 3]),
    })
  }
  candidates.sort((x, y) => x.dmin_km - y.dmin_km)
  device.destroy()

  return {
    supported: true,
    objects: n,
    pairs_checked: pairs,
    ms: +ms.toFixed(1),
    pairs_per_sec: pairs / (ms / 1000),
    threshold_km: thresholdKm,
    window_s: windowS,
    candidates_found: cand,
    candidates: candidates.slice(0, 100),
    honesty: 'coarse linear-CPA filter on real SGP4 states; candidates are re-screened with full SGP4 by the gateway — the verdict never comes from this pass',
  }
}
