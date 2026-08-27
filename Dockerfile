FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
EXPOSE 4318
CMD ["node", "src/server.js"]
