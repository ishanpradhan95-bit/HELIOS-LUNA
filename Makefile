# Reproduces every baked asset in frontend/public/assets from the raw NASA data.
# Needs: python3 (venv with data-pipeline/requirements.txt) and node >= 22.
PY ?= .venv/bin/python
NODE_BIN ?= .tools/node/bin
export PATH := $(NODE_BIN):$(PATH)

all: data ephemeris dem horizons imagery dsnref horizonsref validate
venv:       ; python3 -m venv .venv && .venv/bin/pip install -r data-pipeline/requirements.txt
data:       ; bash data-pipeline/fetch_nasa_assets.sh
ephemeris:  ; $(PY) data-pipeline/bake_ephemeris.py
dem:        ; mkdir -p data-pipeline/raw/sites/x/y && cd data-pipeline/raw/sites && unzip -oq Landing_Sites.zip -d x && unzip -oq x/Landing_Sites.zip -d x/y
	$(PY) data-pipeline/build_dem.py
horizons:   ; npx tsx data-pipeline/bake_horizons.ts
imagery:    ; $(PY) data-pipeline/bake_ephemeris.py --start 2009-12-01T00:00:00 --end 2011-04-01T00:00:00 --out data-pipeline/raw/validation --name ephemeris_2010
	$(PY) data-pipeline/fetch_imagery.py && $(PY) data-pipeline/prep_imagery.py
dsnref:     ; $(PY) -I data-pipeline/dsn_reference.py
horizonsref: ; npx tsx data-pipeline/horizons_reference.ts
validate:   ; npx tsx data-pipeline/validate.ts
pack:       ; npm run pack:assets
dev:        ; npm run dev
build:      ; npm run build
.PHONY: all venv data ephemeris dem horizons imagery dsnref horizonsref validate pack dev build
