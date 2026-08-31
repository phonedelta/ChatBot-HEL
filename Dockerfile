# ChatBot HEL — Railway / Docker (repo root; app lives in whatsapp/)
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV HOST=0.0.0.0

WORKDIR /app

# Backend dependencies
COPY whatsapp/package.json whatsapp/package-lock.json ./
RUN npm ci --omit=dev

# Dashboard build toolchain (dev deps needed for vite/tsc)
COPY whatsapp/dashboard-app/package.json whatsapp/dashboard-app/package-lock.json ./dashboard-app/
RUN npm ci --prefix dashboard-app

# Application source
COPY whatsapp/ ./

RUN npm run build:dashboard

EXPOSE 8081

CMD ["npm", "start"]
