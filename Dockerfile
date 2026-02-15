# SentinAI - Production Dockerfile
# Multi-stage build for AWS EC2 + Docker Compose deployment

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install aws-cli (for eks get-token/describe-cluster) + kubectl v1.31 + curl
ARG KUBECTL_VERSION=v1.31.4
RUN apk add --no-cache python3 py3-pip curl \
    && pip3 install --break-system-packages --no-cache-dir awscli \
    && ARCH=$(uname -m) \
    && case ${ARCH} in \
         x86_64)  KUBECTL_ARCH="amd64" ;; \
         aarch64) KUBECTL_ARCH="arm64" ;; \
         *)       KUBECTL_ARCH="amd64" ;; \
       esac \
    && curl -sLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${KUBECTL_ARCH}/kubectl" \
    && curl -sLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${KUBECTL_ARCH}/kubectl.sha256" \
    && echo "$(cat kubectl.sha256)  kubectl" | sha256sum -c - \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/kubectl \
    && rm -f kubectl.sha256 \
    && apk del py3-pip \
    && rm -rf /root/.cache /tmp/*

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next \
    && chown nextjs:nodejs .next

RUN mkdir -p data/reports \
    && chown nextjs:nodejs data/reports

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080

ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
