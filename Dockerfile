# ChatBot HEL — WhatsApp service + dashboard (Railway / Docker)
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=8081

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend production deps
COPY whatsapp/package.json whatsapp/package-lock.json ./
RUN npm ci --omit=dev

# Dashboard deps (need devDependencies to build Vite SPA)
COPY whatsapp/dashboard-app/package.json whatsapp/dashboard-app/package-lock.json ./dashboard-app/
RUN npm --prefix dashboard-app ci

# Full source, then build dashboard → src/dashboard/dist
COPY whatsapp/ ./
RUN npm --prefix dashboard-app run build \
    && rm -rf dashboard-app/node_modules

RUN mkdir -p storage/sessions storage/voice-nlu-logs \
    && chown -R node:node /app

USER node

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
