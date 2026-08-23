# Demo capture

The submission video is recorded by driving the **running application** in a real
browser and capturing frames while it moves — not by assembling static
screenshots. Every pixel in the film is the live system: the globe, the gate
verdicts, the descent animation, the storm bands, the GPU throughput numbers.

## Recording it

```bash
# 1. the app must be running (gateway on :8090, vite on :5177)
node dev/mock-gateway.js &
cd frontend && npm run dev -- --port 5177 &

# 2. drive it and capture (~20 min; software GL is the slow part)
node demo/capture.js

# 3. assemble
./demo/assemble.sh          # -> demo/astromesh-round2.mp4
```

`node demo/capture.js --scene 5` re-records a single scene while iterating.

## What each scene shows

| # | Scene | The point |
|---|---|---|
| 1 | Open | the four-state signal, always on screen |
| 2 | Vote refused | non-negotiable rules have no waiver path |
| 3 | The story | one real event walked through every layer |
| 4 | Ground + Ec | DINOv3 land cover; 19.7× over the legal limit |
| 5 | Follow descent | chase camera, live telemetry, honest labelling |
| 6 | Gannon storm | a solar storm reaching into the rulebook |
| 7 | Theme independence | same engine, software release + aircraft dispatch |
| 8 | GPU screening | every catalogue pair, measured on the viewer's GPU |
| 9 | Close | what the four states rest on |

## Honesty

Captions are burned in at capture time and state, where relevant, which layers
are recorded data and which are replay — e.g. the descent motion is a kinematic
replay along a real corridor, and says so on screen.
