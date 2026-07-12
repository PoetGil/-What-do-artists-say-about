(c) Dr Gil Dekel
2026
www.poeticmind.co.uk

# What do artists say about…

An interactive, museum-quality visualization of interview quotations collected during **Dr Gil Dekel's PhD research** into creativity and inspiration. The site runs entirely in the browser with no backend or database.

## Project overview

Visitors explore themes from interviews with poets, painters, and installation artists through a constellation of organic polygons. Each polygon represents one theme; its size reflects how many quotations appear under that theme. Click a theme to read the quotations, filter by artist group, or search across themes, artists, and quote text.

## Folder structure

```
.
├── index.html      Main page
├── style.css       Styles
├── script.js       Application logic (D3.js visualization)
├── dataset.csv     Interview quotation data
└── README.md       This file
```

## How dataset.csv is read

On first load, the site fetches `dataset.csv` once using D3's CSV parser. The parsed data is cached in memory for the session. Filters, search, and navigation all operate on that cached dataset without reloading the file.

Expected columns:

- `id`
- `artist_group`
- `artist_name`
- `theme`
- `quote`
- `paragraph_number_in_interview`
- `pdf_page`
- `order`

Only `artist_group`, `artist_name`, `theme`, `quote`, `paragraph_number_in_interview`, and `order` are used by the visualization.

## Replacing dataset.csv

1. Export or save your updated file as `dataset.csv` (UTF-8 encoding, RFC 4180 CSV).
2. Place it in the same folder as `index.html`, replacing the existing file.
3. Refresh the browser.

Statistics, theme counts, polygon sizes, and quotations update automatically from the new file. No code changes are required unless the column structure changes.

## Local preview

Because the site loads `dataset.csv` via `fetch`, it must be served over HTTP (not opened as a `file://` URL).

From this folder, run any static file server. Examples:

**Python 3**

```bash
python -m http.server 8080
```

**Node.js (npx)**

```bash
npx --yes serve -l 8080
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

## GitHub Pages deployment

1. Create a GitHub repository.
2. Upload these files to the repository root (or to a `/docs` folder if you prefer that Pages source):
   - `index.html`
   - `style.css`
   - `script.js`
   - `dataset.csv`
3. In the repository, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Choose your branch (usually `main`) and folder (`/` or `/docs`).
6. Save. GitHub will publish the site at:

   `https://<username>.github.io/<repository>/`

Theme URLs use hash routing, for example:

- `https://<username>.github.io/<repository>/#logic`
- `https://<username>.github.io/<repository>/#logic?group=poets`

## WordPress (Divi) embedding

The project is static HTML/CSS/JavaScript and requires no server-side processing.

### Option 1: iframe (recommended)

1. Host the files on GitHub Pages or any static host.
2. In Divi, add a **Code** module to your page.
3. Insert:

```html
<iframe
  src="https://your-domain.com/path-to-project/"
  title="What do artists say about…"
  width="100%"
  height="900"
  style="border:0; min-height:80vh;"
  loading="lazy"
></iframe>
```

Adjust `height` and `src` as needed.

### Option 2: Self-hosted files

1. Upload `index.html`, `style.css`, `script.js`, and `dataset.csv` to your WordPress media folder or a subdirectory on your server.
2. Link to the hosted `index.html` in an iframe as above, or redirect visitors to that URL.

Ensure all four files remain in the same directory so relative paths continue to work.

## Dependencies

- [D3.js v7](https://d3js.org/) loaded from jsDelivr CDN
- [Google Fonts](https://fonts.google.com/): Cormorant Garamond, Inter

No build step or package manager is required.

## Browser support

Modern evergreen browsers (Chrome, Firefox, Safari, Edge). Requires JavaScript enabled.

## License and attribution

Interview data and research context belong to Dr Gil Dekel's PhD research. See the thesis link in the site sidebar for full academic context.
