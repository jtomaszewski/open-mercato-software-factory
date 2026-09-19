ARG OPENCODE_BASE_IMAGE=docker.io/openmercatocom/open-mercato-opencode:1.18.3
ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim

FROM ${NODE_IMAGE} AS node
FROM ${OPENCODE_BASE_IMAGE}

USER root
COPY --from=node /usr/local/ /usr/local/
RUN rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && corepack enable \
  && node --version | grep '^v24\.' \
  && corepack --version \
  && apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=opencode:opencode docker/opencode/agents-local/factory_developer.md /home/opencode/.config/opencode/agents/factory_developer.md
COPY --chown=opencode:opencode docker/factory-runner/export-source.mjs /usr/local/bin/factory-export-source.mjs
RUN sed -i 's#/home/opencode/work/\*\*#/workspace/repository/**#g' /home/opencode/.config/opencode/agents/factory_developer.md \
  && grep -F '"/workspace/repository/**": allow' /home/opencode/.config/opencode/agents/factory_developer.md

USER opencode
WORKDIR /workspace/repository
EXPOSE 4096
