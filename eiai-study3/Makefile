# Study 3 build (STUDY3_SPEC_v3.md section 10, day 7).
#
# The target that matters is `make paper`: a clean clone must produce the full
# results document from bot data with one command. Everything else exists so
# that target can be assembled from pieces that are individually runnable.
#
#   make install    dependencies (pnpm + Playwright's Chromium)
#   make verify     everything CI gates on
#   make sim        synthetic participants -> tables -> recovery
#   make paper      the whole chain, ending in paper/results.pdf
#   make repro      proves the projections and generated files are reproducible
#   make clean      remove generated data (never touches materials/)

PYTHON ?= python
PNPM   ?= pnpm

DATA        := data
TABLES      := $(DATA)/tables
EVENTS      := $(DATA)/sim-events.jsonl
TRUTH       := $(DATA)/sim-truth.csv
RESULTS     := $(DATA)/results.json
MULTIVERSE  := $(DATA)/multiverse
PAPER       := paper

# Sessions per policy per condition. 60 is the pre-registered figure; CI
# overrides it downward because the point there is that the chain runs, not
# that the intervals are tight.
N ?= 60

.PHONY: all install verify sim paper repro clean help

all: paper

help:
	@echo "install  verify  sim  paper  repro  clean"

install:
	$(PNPM) install --frozen-lockfile
	$(PNPM) exec playwright install --with-deps chromium

verify:
	$(PNPM) run verify

# --- synthetic data -------------------------------------------------------
# Written as real file targets rather than .PHONY so that `make paper` twice in
# a row does not silently regenerate the log with a new random seed draw and
# quietly change the numbers in a document that is supposed to be reproducible.

$(EVENTS):
	$(PYTHON) pipeline/simulate.py --n $(N) --out $(EVENTS)

$(TABLES)/trials.csv: $(EVENTS) pipeline/replay.py
	$(PYTHON) pipeline/replay.py --events $(EVENTS) --out $(TABLES)

$(RESULTS): $(TABLES)/trials.csv pipeline/analysis.py
	$(PYTHON) pipeline/analysis.py --tables $(TABLES) --recover $(TRUTH) --json $(RESULTS)

$(MULTIVERSE)/specification_curve.csv: $(TABLES)/trials.csv pipeline/multiverse.py
	$(PYTHON) pipeline/multiverse.py --tables $(TABLES) --out $(MULTIVERSE)

sim: $(RESULTS)

# --- the paper ------------------------------------------------------------

$(PAPER)/results.html: $(RESULTS) $(MULTIVERSE)/specification_curve.csv pipeline/report.py
	$(PYTHON) pipeline/report.py --results $(RESULTS) --multiverse $(MULTIVERSE) \
		--out $(PAPER)/results.html

$(PAPER)/results.pdf: $(PAPER)/results.html scripts/html-to-pdf.mjs
	node scripts/html-to-pdf.mjs $(PAPER)/results.html $(PAPER)/results.pdf

paper: $(PAPER)/results.pdf
	@echo
	@echo "  $(PAPER)/results.pdf"

# --- reproducibility ------------------------------------------------------
# Every generated artefact regenerates identically, or this fails. That is the
# claim the repository makes about itself, so it is gated rather than asserted.

repro:
	$(PYTHON) pipeline/allocation.py --check
	$(PYTHON) pipeline/replay.py --events $(EVENTS) --out $(TABLES) --check
	$(PNPM) run codegen:check
	$(PYTHON) pipeline/hash_manifest.py --check

clean:
	rm -rf $(DATA) $(PAPER)
	@echo "removed generated data; materials/ is untouched"
