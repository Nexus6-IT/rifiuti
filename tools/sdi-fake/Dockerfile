# Immagine lean: nessuna dipendenza npm (solo moduli built-in di Node), nessun passo di build.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY src ./src
USER node
EXPOSE 4020
CMD ["node", "src/server.js"]
