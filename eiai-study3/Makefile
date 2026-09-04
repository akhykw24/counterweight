# Study 3 build (STUDY3_SPEC_v3.md section 10, day 7).
#
# The target that matters is `make paper`: a clean clone must produce the full
# results document from bot data with one command. Everything else exists so
# that target can be assembled from pieces that are individually runnable.
#
#   make install    dependencies (pnpm + Playwright's Chromium)
#   make verify     everything CI gates on
#   make sim        synthetic participants -> tables -> recovery
#   make exclusions the section 8.6 criteria, counted per criterion
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
EXCLUSIONS  := $(DATA)/exclusions.json
MULTIVERSE  := $(DATA)/multiverse
PAPER       := paper

# Sessions per policy per condition. 60 is the pre-registered figure; CI
# overrides it downward because the point there is that the chain runs, not
# that the intervals are tight.
N ?= 60

.PHONY: all install verify sim exclusions paper repro clean help

all: paper

help:
	@echo "install  verify  sim  exclusions  paper  repro  clean"

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

# Exclusions are their own step with their own output (spec v2 section 8.6).
# Kept separate from the analysis so the per-criterion counts exist as a file
# somebody can read without running the analysis, and so nobody can adjust them
# after seeing a result.
$(EXCLUSIONS): $(TABLES)/trials.csv pipeline/exclusions.py
	$(PYTHON) pipeline/exclusions.py --tables $(TABLES) --out $(EXCLUSIONS)

$(RESULTS): $(TABLES)/trials.csv $(EXCLUSIONS) pipeline/analysis.py
	$(PYTHON) pipeline/analysis.py --tables $(TABLES) --recover $(TRUTH) --exclusions --json $(RESULTS)

$(MULTIVERSE)/specification_curve.csv: $(TABLES)/trials.csv pipeline/multiverse.py
	$(PYTHON) pipeline/multiverse.py --tables $(TABLES) --out $(MULTIVERSE)

sim: $(RESULTS)

exclusions: $(EXCLUSIONS)

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
