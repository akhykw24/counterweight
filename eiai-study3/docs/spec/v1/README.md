# Specification v1 — frozen 2026-09-02

This directory is the specification **as it stood before the adults-only,
English-only decision**. It is never edited. v2 lives in `../v2/`.

A note on numbering, because it collides. The repository already contained files
called `STUDY3_SPEC_v2.md` and `STUDY3_SPEC_v3.md`; those are earlier drafts of
the *same* design, and `v3` was the active source of truth. The `v1` / `v2` in
`docs/spec/` is a **new** numbering that starts here:

    docs/spec/v1  =  the design as audited on 2026-09-02  (was STUDY3_SPEC_v3.md)
    docs/spec/v2  =  adults-only, English-only, CEFR-stratified

| File | Source | SHA-256 |
|---|---|---|
| `STUDY3_SPEC.md` | `docs/STUDY3_SPEC_v3.md` | `2c159306016d39bcbeef1826ebfab421fb2f6678e17d0ba1b18ff894391f817c` |
| `STUDY3_SPEC_science_core.md` | `docs/STUDY3_SPEC_v2.md` | `1c2899ebe6efad914ab56dc21c9ab1847ab9c4366ed7adaaf16589e30da08646` |

Verify with:

```bash
python - <<'EOF'
import hashlib, pathlib
for p in sorted(pathlib.Path('docs/spec/v1').glob('*.md')):
    if p.name == 'README.md': continue
    raw = p.read_bytes().replace(b'
', b'
')
    print(hashlib.sha256(raw).hexdigest(), p.name)
EOF
```
