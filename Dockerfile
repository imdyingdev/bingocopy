FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm ci --only=production

COPY .env ./.env
COPY . .

CMD ["npm", "start"]