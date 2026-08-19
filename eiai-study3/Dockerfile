# Reproducible build environment (STUDY3_SPEC_v3.md section 10, day 7).
#
#   docker build -t eiai-study3 .
#   docker run --rm -v "$PWD/paper:/app/paper" eiai-study3
#
# The claim this image exists to support is that a clean clone plus one command
# produces the results document. Pinning the base image is what makes that
# claim survive contact with a machine that is not mine: an unpinned `node:22`
# would drift, and a result that cannot be regenerated in two years is not a
# reproducible result.
#
# Built on the Playwright image rather than a plain node image because the
# end-to-end suite and the PDF renderer both need a real Chromium with its
# system libraries, and assembling those by hand is a long apt-get list that
# breaks quietly.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

# Python is not in the Playwright image. The pipeline is Python; the app is
# TypeScript. Both halves have to be present for `make paper` to run end to end.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv make \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

WORKDIR /app

# Dependency manifests first, so an edit to a source file does not invalidate
# the dependency layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY packages/fsm/package.json packages/fsm/
COPY packages/stimuli/package.json packages/stimuli/
COPY packages/telemetry/package.json packages/telemetry/
COPY apps/study/package.json apps/study/
COPY services/ingest/package.json services/ingest/

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

# Chromium ships with the base image; this just registers it with Playwright.
RUN pnpm exec playwright install chromium

# `make paper` rather than a shell: the image should do the thing the
# repository promises, so that `docker run` is itself the reproduction check.
CMD ["make", "paper"]
