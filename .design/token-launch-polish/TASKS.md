# Tasks: token-launch-polish

## Wave 1: width + wizard polish
- [x] 1. OfficialTokenClient: widen shell to 1360px, scale header/stats/grids for lg/xl
- [x] 2. DexScreenerChart: mascot empty state, height scales with breakpoint on both states
- [x] 3. JupiterSwap: tighten unavailable state, remove hollow 120px void
- [x] 4. TokenDetailClient: same 1360px shell + sidebar widths for consistency
- [x] 5. Launch page: card wrapper, single refined stepper, remove duplicate progress bar
- [x] 6. StepTokenDetails: full-width dropzone + structured preview row
- [x] 7. globals.css: upload-box becomes full-width dropzone

## Wave 2: demo + GitHub proof
- [x] 8. /demo dev-only route: both token pages + wizard with fixtures, live market data, state switcher
- [x] 9. WizardPanel extraction so /launch and /demo share markup
- [x] 10. StepGitHub redesign: avatar identity card, repo activity card with commits, tier ladder
- [x] 11. GET /api/v1/github/activity endpoint (auth, own repos only)

## Wave 3: contribution graph + spacing fixes
- [x] 12. GET /api/v1/github/contributions endpoint (public data, rate limited, 1h cache)
- [x] 13. ContributionGraph component (GitHub-style heatmap, Vault Green levels)
- [x] 14. Graph in wizard GitHub step + token detail dev profile
- [x] 15. Fix swap card stretch void; detail grid right column stacks profile + product link

## Wave 4: matched launches + dither header (WSL workers)
- [x] 16. /match page: program pitch, how it works, terms, GitHub-gated application form (worker: match)
- [x] 17. POST /api/v1/match/apply + match_applications migration (006) + sitemap entry (worker: match)
- [x] 18. DitherWave ambient background in official token header (worker: dither, scrim retuned in review)
- [x] 19. Review worker output, Playwright screenshots desktop + mobile, empty-ticker normalization fix
