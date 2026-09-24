# Identical to the SUT's Dockerfile, plus trust for an extra CA certificate
# (see docker/compose.extra-ca.yml). Build context = the SUT checkout.
FROM node:18-alpine

WORKDIR /app

COPY --from=certs extra-ca.crt /usr/local/share/ca-certificates/extra-ca.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/extra-ca.crt

COPY package.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
