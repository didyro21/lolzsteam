# LZT Market Power-User Suite

a browser extension designed  for **lzt.market**. This extension adds a lot of tools for resellers / account buyers 
---
![preview](https://i.imgur.com/JpQHMbK.png)
##  How it works 

###  1. AI currency audit engine
* **Automated External Spent Tracker:** Scrapes account transaction tables instantly, filtering out internal Steam Wallet movements to calculate exactly how much *real* external money (credit cards, PayPal, etc.) has been loaded.
* **Claude 4.5 Haiku Integration:** Connects securely to a provider endpoint (as a placeholder i put for example `https://api.wellflow.dev`, but you can use any by editing `popup.js`) to double-check text formatting and correct overlapping currency tags (e.g., stopping the native regex engine from mistaking `Mex$200` or `NT$` for USD).
* **Live Token Debug Logs:** Features a slide-down code box ("View Logs") directly in the UI to preview the exact JSON payload sent to Claude and the raw responses returned.
* **Smart Math Normalization:** Intelligently identifies and fixes localized thousands-separators vs. decimal commas across global currency variations (e.g., correcting `₩ 209,000` anomalies on the fly).

### 2 Search automation
* **Sequential Queue Injector:** Bypasses buggy window scroll listeners by automatically queuing and fetching account listing data as soon as pages load, safely staggering requests (600ms behavior mimic delay) to avoid server rate limits.
* **Bulk Upload Autoskip:** A smart toggle that memorizes the *Seller*, *Title*, and *Price* of listed items. If an identical row matches sequentially, it flags the row with a custom blue **"Skipped (Bulk)"** tag—saving your server API token overhead.

### 3 Security & Account searching
* **Trade Ban Finder:** Since LZT doesnt have a correct way of finding trade banned accounts (since tradeban message is considered a community ban), it was a struggle to find one before, having to manually check each listed account. However now this is much easier. 
* **How to use:** Simply scroll all the way down on a page, so it loads as much as possible, then click on "Find trade ban accounts" from the plugin popup, and find accs. 

### 4 Designed Customised Themes
* **Frosted Glass UI Overlay:** Injects high-end `backdrop-filter: blur()` layers directly over your background design across headers, sidebars, search elements, and data listings.
* **Sleek Popup Layout:** Re-skins the extension popup with heavy rounded frames, seamless focus states, fluid container padding, and responsive pill buttons matching modern design trends.
* **Cleaned DOM Elements:** Completely hides clutter, removes heavy static box-shadow panels, and flattens floating controls like the "Back to top" navigation arrow to a transparent hover state.

---

## Structure

The project code is modularized into these lightweight root components:
* `manifest.json`: Holds host permissions configurations and extension scopes.
* `popup.html` & `popup.js`: Controls the main control menu, bulk fixes, trade ban filters, and AI log pipes.
* `content.js` & `content.css`: Operates directly on the webpage to scan list containers, format numbers, and render the frosted-glass style sheets.

---

##  !!! Installation & Setup

1. **Clone or Download** this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the upper right-hand corner.
4. Click **Load unpacked** in the top left-hand corner and select the project directory.
5. Click the extension icon, press the **Gear icon (⚙️)**, input your Wellflow API key (`sk-...`), and click the gear again to save.
6. Head to **lzt.market**, toggle on your automation settings, and experience the upgrade!

---
