# Brand ownership on GitHub (no personal name in links)

Product name: **Foxy's Premium Upscaling**  
Org (brand home): **`foxys-lab`**  
Repo: **`foxys-lab/foxys-premium-upscaling`**

Personal GitHub accounts should only be **members/admins**, never the public product owner.

## One-time setup (you do this in the browser)

### 1. Create the free organization

1. Open: https://github.com/account/organizations/new?plan=free  
   (or **Settings → Organizations → New organization**)
2. Organization name: **`foxys-lab`**
3. Contact email: any email you control (can be brand-only)
4. Complete the free plan flow

### 2. Transfer this repository

1. Open the current repo (while still under your personal account)
2. **Settings → General → Danger Zone → Transfer ownership**
3. New owner: **`foxys-lab`**
4. Confirm the repo name: `foxys-premium-upscaling`

Or with GitHub CLI (after org exists and `gh` has org scopes):

```bash
gh auth refresh -h github.com -s admin:org,repo
gh api repos/YOUR_PERSONAL_LOGIN/foxys-premium-upscaling/transfer \
  -X POST -f new_owner=foxys-lab
```

### 3. Point local git at the new remote

```bash
cd ~/projects/foxys-premium-upscaling
git remote set-url origin https://github.com/foxys-lab/foxys-premium-upscaling.git
git fetch origin
git branch -u origin/main main
```

### 4. GitHub Pages URL (friends share this)

After Pages is enabled under the org:

`https://foxys-lab.github.io/foxys-premium-upscaling/`

Optional later: custom domain like `upscale.yourdomain.com` so even “github.io” is hidden.

## What friends should see

| Share | URL |
|-------|-----|
| Code | `https://github.com/foxys-lab/foxys-premium-upscaling` |
| Live app | `https://foxys-lab.github.io/foxys-premium-upscaling/` |

No personal name in either link.

## Privacy tip

Keep your personal profile private/minimal. Org **Members** can be hidden (org Settings → Member privileges → base permissions / member visibility).

---

## Status

- [x] Org `foxys-lab` created (free plan)
- [x] Repo transferred to `foxys-lab/foxys-premium-upscaling`
- [x] Local `origin` → org remote
- [x] GitHub Pages enabled (Actions workflow)
- [x] Public membership unlisted where possible

**Share with friends:** https://github.com/foxys-lab/foxys-premium-upscaling  
**Live (after first green Pages deploy):** https://foxys-lab.github.io/foxys-premium-upscaling/
