# Deploy to GitHub Pages

This project is configured for automatic deployment to GitHub Pages.

## Setup

1. **Create a new repository** on GitHub (e.g. `PersonalWeb` or `DS_Profolio`).

2. **Initialize git and push** (if not already done):

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

3. **Enable GitHub Pages** in your repo:
   - Go to **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions**

4. **Push to deploy** — every push to `main` will trigger a build and deploy.

## URL

After deployment, your site will be live at:

- **Project site:** `https://YOUR_USERNAME.github.io/YOUR_REPO/`
- **User site:** `https://YOUR_USERNAME.github.io/` (if repo is `YOUR_USERNAME.github.io`)

## Local preview with basePath

To preview the production build locally (with correct asset paths):

```bash
BASE_PATH=/YOUR_REPO npm run build
npx serve out
```
