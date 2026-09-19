# Developer agent runner (execution spec EX-P0): one disposable container per delegated task.
# node + git for the target's own toolchain, plus the OpenCode build Open Mercato pins (1.18.3),
# copied from its image so the harness matches the execution spec. No credentials are baked in;
# the host mounts the checkout at /work and passes only the model key.
ARG OPENCODE_IMAGE=docker.io/openmercatocom/open-mercato-opencode:1.18.3
FROM ${OPENCODE_IMAGE} AS opencode

FROM node:22-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=opencode /usr/local/bin/opencode /usr/local/bin/opencode
COPY --chown=node:node opencode.json /home/node/.config/opencode/opencode.json
USER node
WORKDIR /work
ENTRYPOINT ["opencode"]
