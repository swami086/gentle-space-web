FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3040

CMD ["sh", "-c", "npx tsx lib/db/migrate.ts && npm start"]
