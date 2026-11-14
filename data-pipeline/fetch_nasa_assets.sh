#!/bin/bash
# Downloads every raw input the pipeline needs into data-pipeline/raw/ (git-ignored).
# Sources: LOLA GDR polar DEMs (MIT/PDS Geosciences mirror), NAIF generic SPICE kernels,
# Wueller et al. 2026 candidate-site dataset (Zenodo, CC-BY-4.0).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p raw/kernels raw/lola raw/sites
get() { # url dest
  if [ -s "$2" ]; then echo "have $2"; else echo "get  $2"; curl -fL --retry 5 -C - -sS -o "$2.part" "$1" && mv "$2.part" "$2"; fi
}
NAIF=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
get $NAIF/lsk/naif0012.tls                              raw/kernels/naif0012.tls
get $NAIF/pck/pck00011.tpc                              raw/kernels/pck00011.tpc
get $NAIF/pck/moon_pa_de440_200625.bpc                  raw/kernels/moon_pa_de440_200625.bpc
get $NAIF/fk/satellites/moon_de440_250416.tf            raw/kernels/moon_de440_250416.tf
get $NAIF/pck/earth_1962_260806_2126_combined.bpc       raw/kernels/earth_combined.bpc
get $NAIF/spk/planets/de440s.bsp                        raw/kernels/de440s.bsp
get "https://zenodo.org/api/records/17084058/files/Landing_Sites.zip/content" raw/sites/Landing_Sites.zip
LOLA=https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG
for f in LDEM_60S_240M LDEM_80S_20M; do
  get $LOLA/$f.LBL raw/lola/$f.LBL
  get $LOLA/$f.IMG raw/lola/$f.IMG
done
echo "fetch complete"
