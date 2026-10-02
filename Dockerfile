FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV IMAGE_ENABLED=false

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["npm", "start"]