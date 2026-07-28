FROM node:20-alpine
LABEL description="Angelic Py - Web Visual Novel Reader"

WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy application code
COPY server.js ./
COPY public ./public

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/data

CMD ["node", "server.js"]
