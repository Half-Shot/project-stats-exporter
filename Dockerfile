# Stage 0: Build the thing
FROM node:18-alpine AS builder

COPY . /build
WORKDIR /build

RUN yarn --pure-lockfile && yarn build && yarn cache clean

# Stage 1: The actual container
FROM node:16-alpine
RUN mkdir /app
COPY --from=builder /build/lib /app/lib
COPY --from=builder /build/yarn.lock /app
COPY --from=builder /build/package*.json /app
WORKDIR /app

RUN yarn --production --pure-lockfile && yarn cache clean

VOLUME /data
EXPOSE 8080

CMD ["node", "/app/lib/app.js"]
