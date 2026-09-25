# Aşama 1: Bağımlılıkları derleme (Native modüller: bcrypt, sqlite3)
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# Aşama 2: Üretim Çalışma Zamanı (Ultra hafif, derleyicisiz, ~100MB)
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY public ./public

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "src/server.js"]
