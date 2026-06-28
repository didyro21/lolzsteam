let settings = { autoScan: true, debugMode: false, autoSkip: false };

function debugLog(...args) {
    if (settings.debugMode) {
        console.log("🛠️ [LZT Checker]:", ...args);
    }
}

// 1. Read Settings & Initialize
chrome.storage.local.get(['autoScan', 'debugMode', 'autoSkip'], (res) => {
    if (res.autoScan !== undefined) settings.autoScan = res.autoScan;
    if (res.debugMode !== undefined) settings.debugMode = res.debugMode;
    if (res.autoSkip !== undefined) settings.autoSkip = res.autoSkip;

    debugLog("Settings loaded:", settings);

    if (settings.autoScan) {
        setupListings();
        mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
});

let globalRates = null;
fetch('https://open.er-api.com/v6/latest/USD')
    .then(res => res.json())
    .then(data => globalRates = data.rates)
    .catch(() => debugLog("Failed to fetch currency rates"));

const queue = [];
let isProcessing = false;

function enqueueItem(item) {
    if (!item.hasAttribute('data-lzt-queued')) {
        item.setAttribute('data-lzt-queued', 'true');
        queue.push(item);
        processQueue();
    }
}

async function processQueue() {
    if (isProcessing) return; 
    
    isProcessing = true;
    try {
        while (queue.length > 0) {
            const item = queue.shift();
            await fetchAndTagItem(item);
            await new Promise(r => setTimeout(r, 600)); 
        }
    } catch (err) {
        debugLog("Queue processing error:", err);
    } finally {
        isProcessing = false; 
    }
}

// 2. Setup function (Removed broken Scroll Observer, directly queues!)
function setupListings(node = document) {
    const listings = node.querySelectorAll('.marketIndexItem');

    listings.forEach(item => {
        const titleLink = item.querySelector('a.marketIndexItem--Title, a.marketIndexItem--title, .marketIndexItem--TitleData a, .similar-title');
        
        if (titleLink && !item.querySelector('.lzt-ext-tag')) {
            const tag = document.createElement('span');
            tag.className = 'lzt-ext-tag';
            
            let isBulk = false;
            
            if (settings.autoSkip) {
                let prevItem = item.previousElementSibling;
                while (prevItem && !prevItem.classList.contains('marketIndexItem')) {
                    prevItem = prevItem.previousElementSibling;
                }

                if (prevItem) {
                    const prevTitleLink = prevItem.querySelector('a.marketIndexItem--Title, a.marketIndexItem--title, .marketIndexItem--TitleData a, .similar-title');
                    const prevSellerNode = prevItem.querySelector('.username .styleUserNickname') || prevItem.querySelector('.username');
                    const prevPriceNode = prevItem.querySelector('.marketIndexItem--Price .Value, .price .value, .Value');

                    const currSellerNode = item.querySelector('.username .styleUserNickname') || item.querySelector('.username');
                    const currPriceNode = item.querySelector('.marketIndexItem--Price .Value, .price .value, .Value');

                    const prevTitle = prevTitleLink ? prevTitleLink.innerText.trim() : '';
                    const prevSeller = prevSellerNode ? prevSellerNode.innerText.trim() : '';
                    const prevPrice = prevPriceNode ? prevPriceNode.innerText.trim() : '';

                    const currTitle = titleLink.innerText.trim();
                    const currSeller = currSellerNode ? currSellerNode.innerText.trim() : '';
                    const currPrice = currPriceNode ? currPriceNode.innerText.trim() : '';

                    if (currTitle && currSeller && currTitle === prevTitle && currSeller === prevSeller && currPrice === prevPrice) {
                        isBulk = true;
                    }
                }
            }

            if (isBulk) {
                tag.textContent = 'Skipped (Bulk)';
                tag.classList.add('skipped');
                titleLink.insertAdjacentElement('afterend', tag);
                debugLog("Skipped bulk item:", titleLink.innerText);
            } else {
                tag.textContent = '⏳ Waiting...';
                titleLink.insertAdjacentElement('afterend', tag);
                
                // Directly toss it into the queue! No more waiting for scroll interactions.
                enqueueItem(item);
            }
        }
    });
}

const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach(mut => {
        mut.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
                if (node.classList.contains('marketIndexItem')) setupListings(node.parentNode);
                else setupListings(node);
            }
        });
    });
});

async function fetchAndTagItem(item) {
    const tag = item.querySelector('.lzt-ext-tag');
    const titleLink = item.querySelector('a.marketIndexItem--Title, a.marketIndexItem--title, .marketIndexItem--TitleData a, .similar-title');
    
    if (!tag || !titleLink) return;
    
    tag.textContent = '🔍 Scanning...';
    debugLog(`Scanning URL: ${titleLink.href}`);
    
    try {
        const url = titleLink.href;
        const response = await fetch(url);
        const html = await response.text();
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const result = parseLZTDocument(doc);
        
        if (result.error) {
            tag.textContent = "N/A";
            debugLog(`Scan Error: ${result.error}`);
            return;
        }

        const total = result.totalUSD;
        tag.textContent = `Ext: $${total.toFixed(2)}`;
        
        if (result.hasUncertain) {
            tag.classList.add('uncertain');
            tag.textContent += ' ⚠️';
        } else if (total > 350) {
            tag.classList.add('safe');
        } else {
            tag.classList.add('fail');
        }

        debugLog(`Scan Complete: $${total.toFixed(2)}`);

    } catch (e) {
        tag.textContent = 'Error';
        debugLog("Network or parsing error", e);
    }
}

function parseLZTDocument(doc) {
    const rows = doc.querySelectorAll('.transactionList table.dataTable tr.dataRow');
    if (rows.length === 0) return { error: "No rows" };

    let detectedYenOrYuan = 'CNY'; 
    const counters = doc.querySelectorAll('.marketItemView--counters .counter');
    counters.forEach(c => {
        const mutedText = c.querySelector('.muted') ? c.querySelector('.muted').innerText.trim().toLowerCase() : '';
        const labelText = c.querySelector('.label') ? c.querySelector('.label').innerText.trim().toLowerCase() : '';
        if (mutedText === 'country' || mutedText === 'страна') {
            if (labelText.includes('china') || labelText.includes('китай')) detectedYenOrYuan = 'CNY';
            if (labelText.includes('japan') || labelText.includes('япония')) detectedYenOrYuan = 'JPY';
        }
    });

    const tableText = doc.querySelector('.transactionList') ? doc.querySelector('.transactionList').innerText : "";
    if (tableText.includes('Conversion to JPY')) detectedYenOrYuan = 'JPY';
    else if (tableText.includes('Conversion to CNY')) detectedYenOrYuan = 'CNY';

    const currencyMap = {
        '€': 'EUR', '$': 'USD', '£': 'GBP', '₴': 'UAH',
        '₽': 'RUB', '₸': 'KZT', 'zł': 'PLN', '¥': detectedYenOrYuan,
        '₺': 'TRY', 'R$': 'BRL', 'HK$': 'HKD', 'pуб': 'RUB', 'руб': 'RUB',
        'RM': 'MYR', 'CHF': 'CHF', 'NT$': 'TWD'
    };

    const sortedCurrencySymbols = Object.keys(currencyMap).sort((a, b) => b.length - a.length);

    let totalUSD = 0;
    let hasUncertain = false;
    let foundTransactions = 0;

    rows.forEach((row) => {
        const tds = row.querySelectorAll('td');
        if (tds.length >= 5) {
            const totalText = tds[1].innerText.trim();
            const sourceText = tds[4].innerText.trim();
            
            if (totalText !== "" && sourceText.toLowerCase() !== 'wallet') {
                foundTransactions++;
                let cleanText = totalText.replace(/--/g, '00'); 
                let amountMatch = cleanText.match(/[\d]+[\d\s\.,]*/);
                
                if (amountMatch) {
                    let rawMatch = amountMatch[0].replace(/\s/g, '').replace(/[\.,]$/, '');
                    
                    if (rawMatch.includes(',') && rawMatch.includes('.')) {
                        if (rawMatch.lastIndexOf(',') > rawMatch.lastIndexOf('.')) {
                            rawMatch = rawMatch.replace(/\./g, '').replace(',', '.');
                        } else {
                            rawMatch = rawMatch.replace(/,/g, '');
                        }
                    } else if (rawMatch.includes(',')) {
                        if (/,\d{3}$/.test(rawMatch)) {
                            rawMatch = rawMatch.replace(/,/g, '');
                        } else {
                            rawMatch = rawMatch.replace(',', '.');
                        }
                    }
                    
                    let amount = parseFloat(rawMatch);
                    
                    if (!isNaN(amount)) {
                        let currency = 'USD'; 
                        let uncertain = true; 
                        let matched = false;
                        
                        for (const symbol of sortedCurrencySymbols) {
                            if (totalText.includes(symbol)) {
                                currency = currencyMap[symbol];
                                uncertain = false; 
                                matched = true;
                                break;
                            }
                        }
                        
                        if (!matched) {
                            let extractedSymbol = totalText.replace(/[\d\s\.,\-+]/g, '').trim();
                            currency = extractedSymbol.length > 0 ? extractedSymbol : "???";
                            uncertain = true;
                        }
                        
                        if (totalText.match(/P\s*\d/i) || totalText.match(/\d\s*P/i)) uncertain = true;

                        let usdValue = (globalRates && globalRates[currency]) ? (amount / globalRates[currency]) : amount;
                        totalUSD += usdValue;
                        if (uncertain) hasUncertain = true;
                    }
                }
            }
        }
    });

    if (foundTransactions === 0) return { error: "No valid amounts" };
    return { totalUSD: totalUSD, hasUncertain: hasUncertain };
}