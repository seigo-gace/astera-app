# Stage 1: build frontend assets
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

ARG VITE_ASTERA_API_BASE
ARG VITE_ASTERA_HP_URL
ARG VITE_SUPPORT_DEVELOPMENT_URL
ARG VITE_SUPPORT_CROWDFUNDING_URL
ARG VITE_SUPPORT_PARTNERSHIP_URL

ENV VITE_ASTERA_API_BASE=$VITE_ASTERA_API_BASE
ENV VITE_ASTERA_HP_URL=$VITE_ASTERA_HP_URL
ENV VITE_SUPPORT_DEVELOPMENT_URL=$VITE_SUPPORT_DEVELOPMENT_URL
ENV VITE_SUPPORT_CROWDFUNDING_URL=$VITE_SUPPORT_CROWDFUNDING_URL
ENV VITE_SUPPORT_PARTNERSHIP_URL=$VITE_SUPPORT_PARTNERSHIP_URL

COPY . .
RUN npm run brand:sync && npx vite build

# Stage 2: serve static files with nginx
FROM nginx:alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
