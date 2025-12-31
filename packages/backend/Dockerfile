FROM public.ecr.aws/lambda/nodejs:22-arm64 AS builder

WORKDIR /build

COPY package.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

FROM public.ecr.aws/lambda/nodejs:22-arm64

WORKDIR ${LAMBDA_TASK_ROOT}

COPY package.json ./
RUN npm install --omit=dev && chmod 644 package.json

COPY --from=builder /build/dist/ ./dist/
RUN chmod 644 dist/index.mjs

CMD ["dist/index.handler"]
