# Hugging Face Docker Space — runs the Node gateway, which also serves the built
# Vue frontend (single origin). Listens on HF's required port 7860.
# Runs as the image's built-in `node` user (UID 1000, satisfies HF).
FROM node:20-slim

RUN mkdir -p /app && chown -R node:node /app
USER node
ENV HOME=/home/node PATH=/home/node/.local/bin:$PATH
WORKDIR /app

# Install frontend deps first (also provides satellite.js the gateway requires).
COPY --chown=node:node frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy the rest of the app.
COPY --chown=node:node . /app

# Build the Vue app, injecting the Cesium token from an HF *build secret*.
RUN --mount=type=secret,id=VITE_CESIUM_TOKEN,uid=1000 \
    --mount=type=secret,id=VITE_OWM_KEY,uid=1000 \
    cd frontend && \
    export VITE_CESIUM_TOKEN="$(cat /run/secrets/VITE_CESIUM_TOKEN 2>/dev/null || true)" && \
    export VITE_OWM_KEY="$(cat /run/secrets/VITE_OWM_KEY 2>/dev/null || true)" && \
    npm run build

ENV PORT=7860
EXPOSE 7860
CMD ["node", "dev/mock-gateway.js"]
