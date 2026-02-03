FROM node:20-slim

WORKDIR /app

# Copiamos solo manifests primero (mejor cache)
COPY package*.json tsconfig.json ./
# Necesario para que `postinstall: patch-package` encuentre los parches durante `npm ci`
COPY patches ./patches

# Instalamos deps
RUN npm ci

# Copiamos el resto del código
COPY . .

# 🔥 COMPILAMOS TYPESCRIPT (esto faltaba)
RUN npm run build

ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "run", "start"]
