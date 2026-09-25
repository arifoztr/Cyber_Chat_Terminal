FROM node:22-alpine

WORKDIR /app

# SQLite3 ve bcrypt gibi yerel C++ bağımlılıkları için derleme araçları
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "src/server.js"]
