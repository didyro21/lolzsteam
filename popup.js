let rates = {};
let transactions = [];
let customCurrencies = [];
let isRecentActivity = false;

// Global tracking references for debug panel states
let lastAiRequestLog = "No request sent yet.";
let lastAiResponseLog = "No response fetched yet.";

document.addEventListener('DOMContentLoaded', async () => {
    
    // --- SETTINGS STORAGE BINDINGS ---
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const mainUi = document.getElementById('mainUi');
    const cbAutoScan = document.getElementById('settingAutoScan');
    const cbAutoSkip = document.getElementById('settingAutoSkip');
    const cbDebug = document.getElementById('settingDebug');
    const inputApiKey = document.getElementById('settingApiKey');

    chrome.storage.local.get(['autoScan', 'autoSkip', 'debugMode', 'apiKey'], (res) => {
        cbAutoScan.checked = res.autoScan !== false; 
        cbAutoSkip.checked = res.autoSkip === true; 
        cbDebug.checked = res.debugMode === true;    
        inputApiKey.value = res.apiKey || '';
    });

    cbAutoScan.addEventListener('change', () => chrome.storage.local.set({ autoScan: cbAutoScan.checked }));
    cbAutoSkip.addEventListener('change', () => chrome.storage.local.set({ autoSkip: cbAutoSkip.checked }));
    cbDebug.addEventListener('change', () => chrome.storage.local.set({ debugMode: cbDebug.checked }));
    inputApiKey.addEventListener('input', (e) => chrome.storage.local.set({ apiKey: e.target.value.trim() }));

    settingsBtn.addEventListener('click', () => {
        if (settingsPanel.style.display === 'none' || settingsPanel.style.display === '') {
            settingsPanel.style.display = 'block';
            mainUi.style.display = 'none';
        } else {
            settingsPanel.style.display = 'none';
            mainUi.style.display = 'block';
        }
    });

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes("lzt.market")) {
        document.getElementById('result').textContent = "N/A";
        document.getElementById('amount').textContent = "Please open an LZT account page.";
        return;
    }

    // --- NEW: PERMANENT TRADE BAN FINDER ---
    document.getElementById('findTradeBansBtn').addEventListener('click', async () => {
        const resultsDiv = document.getElementById('tradeBanResults');
        const listUl = document.getElementById('tradeBanList');
        const openAllBtn = document.getElementById('openAllBansBtn');
        const findBtn = document.getElementById('findTradeBansBtn');

        findBtn.textContent = "🔍 Scanning...";
        findBtn.disabled = true;

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: scanForTradeBans
            });

            const bannedAccounts = results[0].result || [];
            listUl.innerHTML = '';
            resultsDiv.style.display = 'block';

            if (bannedAccounts.length > 0) {
                bannedAccounts.forEach(acc => {
                    const li = document.createElement('li');
                    li.style.marginBottom = '6px';
                    li.innerHTML = `<a href="${acc.url}" target="_blank" style="color: #64B5F6; text-decoration: none; word-break: break-word;">${acc.title}</a>`;
                    listUl.appendChild(li);
                });
                
                openAllBtn.style.display = 'block';
                openAllBtn.textContent = `🌐 Open All (${bannedAccounts.length}) in New Tabs`;
                
                openAllBtn.onclick = () => {
                    bannedAccounts.forEach(acc => {
                        chrome.tabs.create({ url: acc.url, active: false });
                    });
                };
            } else {
                listUl.innerHTML = '<li style="color: #EB6060; list-style-type: none; margin-left: -20px; text-align: center;">No permanently trade-banned accounts found on this page.</li>';
                openAllBtn.style.display = 'none';
            }
        } catch (err) {
            console.error("Trade ban scan failed:", err);
        } finally {
            findBtn.textContent = "🔍 Find Perm Trade Bans on Page";
            findBtn.disabled = false;
        }
    });

    // Run primary parse
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: fetchAndParseTransactions
        });

        const scriptResponse = results[0].result;
        if (scriptResponse && scriptResponse.error) throw new Error(scriptResponse.error);

        rates = scriptResponse.rates || {};
        transactions = scriptResponse.transactions || [];
        isRecentActivity = scriptResponse.recentActivity || false;

        recalculateAll();

        const toggleBtn = document.getElementById('toggleList');
        const txListDiv = document.getElementById('txList');

        if (transactions.length > 0) {
            toggleBtn.style.display = "inline-block";
            toggleBtn.addEventListener('click', () => {
                if (txListDiv.style.display === "none" || txListDiv.style.display === "") {
                    txListDiv.style.display = "block";
                    toggleBtn.textContent = "Hide Details";
                } else {
                    txListDiv.style.display = "none";
                    toggleBtn.textContent = "Show Details";
                }
            });
        }

        txListDiv.addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-btn')) {
                const idx = e.target.dataset.index;
                document.getElementById(`view-${idx}`).style.display = 'none';
                document.getElementById(`edit-${idx}`).style.display = 'inline';
            }
            if (e.target.classList.contains('save-btn')) {
                const idx = e.target.dataset.index;
                const newAmt = parseFloat(document.getElementById(`amt-${idx}`).value);
                const newCur = document.getElementById(`cur-${idx}`).value;
                if (!isNaN(newAmt)) {
                    transactions[idx].amount = newAmt;
                    transactions[idx].currency = newCur;
                    transactions[idx].uncertain = false; 
                    transactions[idx].wasReplaced = true; 
                    recalculateAll(); 
                }
            }

            if (e.target.classList.contains('qf-btn')) {
                const targetCurrency = e.target.dataset.cur;
                const parsedRate = parseFloat(document.getElementById(`qf-rate-${targetCurrency}`).value);
                if (!isNaN(parsedRate) && parsedRate > 0) {
                    rates[targetCurrency] = parsedRate;
                    if (!customCurrencies.includes(targetCurrency)) customCurrencies.push(targetCurrency);
                    transactions.forEach(tx => {
                        if (tx.currency === targetCurrency && tx.uncertain) {
                            tx.uncertain = false;
                            tx.wasReplaced = true;
                        }
                    });
                    recalculateAll(); 
                }
            }

            if (e.target.classList.contains('google-check-btn') || e.target.classList.contains('retry-btn')) {
                if (e.target.classList.contains('retry-btn') && e.target.dataset.tabid) {
                    chrome.tabs.remove(parseInt(e.target.dataset.tabid), () => { let err = chrome.runtime.lastError; });
                }

                const targetCurrency = e.target.dataset.cur;
                const resDiv = document.getElementById(`google-res-${targetCurrency}`);
                resDiv.style.display = 'block';
                resDiv.innerHTML = `<span style="color: #aaa;">Scanning Google...</span>`;

                chrome.runtime.sendMessage({ action: "checkGoogleConversion", query: `1 USD in ${targetCurrency}` }, (response) => {
                    if (response && response.success && response.value) {
                        resDiv.innerHTML = `<span class="google-result-success">${response.value} ${targetCurrency}</span> <button class="copy-btn" data-val="${response.value}">Copy</button>`;
                    } else {
                        resDiv.innerHTML = `<span class="google-result-fail">Result not found</span> <button class="retry-btn" data-cur="${targetCurrency}" data-tabid="${response ? response.tabId : ''}">Try Again</button> <button class="manual-btn" data-tabid="${response ? response.tabId : ''}">Check manually</button>`;
                    }
                });
            }

            if (e.target.classList.contains('manual-btn')) {
                const tabId = parseInt(e.target.dataset.tabid);
                if (!isNaN(tabId)) {
                    chrome.tabs.update(tabId, { active: true }, (tab) => {
                        if (chrome.runtime.lastError) alert("The tab was already closed. Click 'Try Again' to open a new one.");
                        else if (tab) chrome.windows.update(tab.windowId, { focused: true });
                    });
                }
            }

            if (e.target.classList.contains('copy-btn')) {
                navigator.clipboard.writeText(e.target.dataset.val);
                e.target.textContent = "Copied!";
                setTimeout(() => e.target.textContent = "Copy", 1500);
            }

            if (e.target.id === 'aiLogToggleBtn') {
                const logBox = document.getElementById('aiLogBoxWindow');
                if (logBox.style.display === 'none' || logBox.style.display === '') {
                    logBox.style.display = 'block';
                    logBox.textContent = `=== [SENT TO CLAUDE] ===\n${JSON.stringify(lastAiRequestLog, null, 2)}\n\n=== [RECEIVED RESPONSE] ===\n${lastAiResponseLog}`;
                    e.target.textContent = "📋 Hide Logs";
                } else {
                    logBox.style.display = 'none';
                    e.target.textContent = "📄 View Logs";
                }
            }

            if (e.target.id === 'aiAnalyseBtn') {
                const aiBtn = e.target;
                aiBtn.disabled = true;
                aiBtn.textContent = "🧠 Analyzing data...";

                chrome.storage.local.get(['apiKey'], async (res) => {
                    const apiKey = res.apiKey || '';
                    if (!apiKey) {
                        alert("Please click the Gear icon (⚙️) on top, insert your Wellflow API key first, and try again!");
                        aiBtn.disabled = false;
                        aiBtn.textContent = "🧠 Analyse with Claude";
                        return;
                    }

                    try {
                        const payloadData = transactions.map((tx, idx) => ({
                            index: idx,
                            originalText: tx.originalText,
                            source: tx.source,
                            currentParsedAmount: tx.amount,
                            currentParsedCurrency: tx.currency
                        }));

                        lastAiRequestLog = payloadData; 

                        const response = await fetch('https://api.wellflow.dev/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify({
                                model: 'claude-haiku-4.5',
                                messages: [
                                    {
                                        role: 'system',
                                        content: 'You are an accurate currency parsing optimization system. Inspect row labels from steam accounts and detect if any transaction currency symbols were wrongly categorized by a naive regex engine. Pay special attention to overlapping currency tags (e.g., mistaking "Mex$200" or "Mex$" as USD instead of Mexican Peso MXN, or "NT$" as USD instead of TWD). Return ONLY a valid JSON object. No explanations, no markdown formatting, no conversational text. Example: {"corrections": [{"index": 0, "amount": 200, "currency": "MXN", "uncertain": false}]}'
                                    },
                                    {
                                        role: 'user',
                                        content: JSON.stringify(payloadData)
                                    }
                                ],
                                response_format: { type: "json_object" }
                            })
                        });

                        const rawData = await response.json();
                        
                        if (rawData.error) {
                            throw new Error(rawData.error.message || JSON.stringify(rawData.error));
                        }
                        
                        if (!rawData.choices || !rawData.choices[0] || !rawData.choices[0].message) {
                            throw new Error("Unexpected API response structure. Raw response: " + JSON.stringify(rawData));
                        }

                        let aiContent = rawData.choices[0].message.content;
                        lastAiResponseLog = aiContent; 

                        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            aiContent = jsonMatch[0];
                        }

                        const parsedRes = JSON.parse(aiContent);

                        if (parsedRes && Array.isArray(parsedRes.corrections)) {
                            if (parsedRes.corrections.length > 0) {
                                parsedRes.corrections.forEach(corr => {
                                    const idx = corr.index;
                                    if (transactions[idx]) {
                                        transactions[idx].amount = corr.amount;
                                        transactions[idx].currency = corr.currency;
                                        transactions[idx].uncertain = corr.uncertain !== undefined ? corr.uncertain : false;
                                        transactions[idx].wasReplaced = true; 
                                    }
                                });
                                recalculateAll(); 
                                aiBtn.disabled = false;
                                aiBtn.textContent = "🧠 Analyse with Claude";
                            } else {
                                aiBtn.disabled = true;
                                aiBtn.textContent = "✅ No issues found";
                                aiBtn.style.background = "#00BA78";
                            }
                        } else {
                            throw new Error("Invalid format returned from model endpoints.");
                        }

                    } catch (aiErr) {
                        console.error("AI Core processing failed:", aiErr);
                        lastAiResponseLog = "Error: " + aiErr.message;
                        alert("AI analysis error: " + (aiErr.message || "Unknown schema processing failure. Check your console logs."));
                        aiBtn.disabled = false;
                        aiBtn.textContent = "🧠 Analyse with Claude";
                    }
                });
            }
        });

    } catch (err) {
        // If not on an account page, just quietly fail the transaction parsing part
        // The Trade Ban Scanner will still work on the search page!
        if (tab.url.includes("lzt.market") && !tab.url.includes("lzt.market/steam") && !tab.url.includes("lzt.market/item")) {
             document.getElementById('result').textContent = "Hello!";
             document.getElementById('amount').textContent = "You are on search list page.";
        }
    }
});

// --- INJECTED FUNCTION: Runs directly on the LZT page ---
function scanForTradeBans() {
    const items = document.querySelectorAll('.marketIndexItem');
    const foundAccounts = [];

    items.forEach(item => {
        // Look for any steamRt span that contains "permanently banned from trading" in its tooltip
        const banNode = item.querySelector('.steamRt[data-cachedtitle*="permanently banned from trading"], .steamRt[title*="permanently banned from trading"]');
        
        if (banNode) {
            const titleLink = item.querySelector('a.marketIndexItem--Title, a.marketIndexItem--title, .marketIndexItem--TitleData a');
            if (titleLink) {
                foundAccounts.push({
                    title: titleLink.innerText.trim(),
                    url: titleLink.href
                });
            }
        }
    });

    return foundAccounts;
}

function recalculateAll() {
    let totalUSD = 0;
    let hasUncertain = false;

    transactions.forEach(tx => {
        let usdValue = (rates && rates[tx.currency]) ? (tx.amount / rates[tx.currency]) : tx.amount;
        tx.usdValue = usdValue;
        totalUSD += usdValue;
        if (tx.uncertain) hasUncertain = true;
    });

    updateMainUI(totalUSD, hasUncertain);
    renderList();
}

function updateMainUI(totalUSD, hasUncertain) {
    const resultDiv = document.getElementById('result');
    const amountDiv = document.getElementById('amount');
    const warningDiv = document.getElementById('warning');
    const actWarningDiv = document.getElementById('actWarning');
    
    amountDiv.textContent = `External spent: $${totalUSD.toFixed(2)}`;
    actWarningDiv.style.display = isRecentActivity ? 'inline-block' : 'none';

    if (totalUSD > 350) {
        resultDiv.textContent = "OK";
        resultDiv.style.color = hasUncertain ? "#FF9800" : "#00BA78"; 
    } else {
        resultDiv.textContent = "No";
        resultDiv.style.color = hasUncertain ? "#FF9800" : "#EB6060"; 
    }

    warningDiv.textContent = hasUncertain ? "Needs manual data parsing for currency" : "";
}

function renderList() {
    const txListDiv = document.getElementById('txList');
    const baseCurrencies = ['USD', 'EUR', 'GBP', 'UAH', 'RUB', 'KZT', 'PLN', 'JPY', 'CNY', 'TRY', 'BRL', 'HKD', 'MYR', 'AUD', 'CHF', 'TWD'];
    const allCurrencies = [...baseCurrencies, ...customCurrencies];
    
    let quickFixHtml = '';
    const uncertainCurrencies = [...new Set(transactions.filter(tx => tx.uncertain).map(tx => tx.currency))];
    
    const aiActionButtonsContainer = `
        <div class="ai-btn-row">
            <button id="aiAnalyseBtn" class="ai-btn">🧠 Analyse with Claude</button>
            <button id="aiLogToggleBtn" class="ai-log-btn">📄 View Logs</button>
        </div>
        <div id="aiLogBoxWindow" class="ai-log-box"></div>
    `;

    if (uncertainCurrencies.length > 0) {
        quickFixHtml = `<div class="quick-fix-box"><strong>⚡ Bulk Quick Fixes</strong><br><span style="color:#aaa; font-size:9px;">Set rate (1 USD = X) to auto-fix unknown entries.</span>`;
        uncertainCurrencies.forEach(cur => {
            let safeCur = cur.replace(/\"/g, '&quot;'); 
            quickFixHtml += `<div class="quick-fix-row"><span>1 USD = <input type="number" id="qf-rate-${safeCur}" value="1" step="0.01" style="width: 50px;"> <b>${safeCur}</b></span><div><button class="qf-btn" data-cur="${safeCur}">Apply</button> <button class="google-check-btn" data-cur="${safeCur}">Google Check</button></div></div><div id="google-res-${safeCur}" style="display:none; text-align: left; margin-top: 6px; padding: 4px; background: #111; border-radius: 3px;"></div>`;
        });
        quickFixHtml += `
            <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 2px;">
                ${aiActionButtonsContainer}
            </div>
        </div>`;
    } else {
        quickFixHtml = aiActionButtonsContainer;
    }

    const txHtml = transactions.map((tx, index) => {
        const selectOptions = allCurrencies.map(c => `<option value="${c}" ${c === tx.currency ? 'selected' : ''}>${c}</option>`).join('');
        const mathClass = tx.wasReplaced ? 'class="replaced"' : '';

        return `
        <div class="tx-item ${tx.uncertain ? 'uncertain' : ''}">
            <b>[${tx.source}]</b> ${tx.originalText}
            <span class="tx-math">
                <span id="view-${index}" ${mathClass}>
                    Parsed: ${tx.amount} ${tx.currency} &rarr; +$${tx.usdValue.toFixed(2)} 
                    <button class="edit-btn" data-index="${index}">✏️ Edit</button>
                </span>
                <span id="edit-${index}" style="display:none;">
                    <input type="number" id="amt-${index}" value="${tx.amount}" step="0.01">
                    <select id="cur-${index}">
                        ${!allCurrencies.includes(tx.currency) ? `<option value="${tx.currency}" selected>${tx.currency}</option>` : ''}
                        ${selectOptions}
                    </select>
                    <button class="save-btn" data-index="${index}">Save</button>
                </span>
            </span>
        </div>
    `}).join('');

    txListDiv.innerHTML = quickFixHtml + txHtml;
}

// --- INJECTED FUNCTION: Fetches Transactions for specific account page ---
async function fetchAndParseTransactions() {
    try {
        const rows = document.querySelectorAll('.transactionList table.dataTable tr.dataRow');
        if (rows.length === 0) return { error: "0 transaction rows found." };

        let rates = null;
        try {
            const response = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await response.json();
            rates = data.rates;
        } catch(e) {}

        let recentActivity = false;
        let detectedYenOrYuan = 'CNY'; 
        let safeOrigin = false; 

        try {
            const counters = document.querySelectorAll('.marketItemView--counters .counter');
            counters.forEach(c => {
                const mutedText = c.querySelector('.muted') ? c.querySelector('.muted').innerText.trim().toLowerCase() : '';
                const labelText = c.querySelector('.label') ? c.querySelector('.label').innerText.trim().toLowerCase() : '';
                if (mutedText === 'country' || mutedText === 'страна') {
                    if (labelText.includes('china') || labelText.includes('китай')) detectedYenOrYuan = 'CNY';
                    if (labelText.includes('japan') || labelText.includes('япония')) detectedYenOrYuan = 'JPY';
                }
                if (mutedText.includes('account origin') || mutedText.includes('происхождение')) {
                    if (labelText.includes('resale') || labelText.includes('перепродажа') || labelText.includes('personal') || labelText.includes('личный') || labelText.includes('autoreg') || labelText.includes('авторег')) safeOrigin = true;
                }
                if (mutedText.includes('last activity') || mutedText.includes('последняя активность')) {
                    const abbr = c.querySelector('abbr.DateTime');
                    if (abbr) {
                        const timestamp = parseInt(abbr.getAttribute('data-time'), 10);
                        if (!isNaN(timestamp)) {
                            const daysDiff = (Math.floor(Date.now() / 1000) - timestamp) / 86400;
                            if (daysDiff < 20) recentActivity = true;
                        }
                    }
                }
            });

            const exactNode = document.querySelector('.label[data-tooltip-id="market_last_activity"] abbr.DateTime');
            if (exactNode) {
                const timestamp = parseInt(exactNode.getAttribute('data-time'), 10);
                if (!isNaN(timestamp)) {
                    const daysDiff = (Math.floor(Date.now() / 1000) - timestamp) / 86400;
                    if (daysDiff < 20) recentActivity = true;
                }
            }
            if (safeOrigin) recentActivity = false;

        } catch(e) {}

        const tableText = document.querySelector('.transactionList') ? document.querySelector('.transactionList').innerText : "";
        if (tableText.includes('Conversion to JPY')) detectedYenOrYuan = 'JPY';
        else if (tableText.includes('Conversion to CNY')) detectedYenOrYuan = 'CNY';

        const currencyMap = {
            '€': 'EUR', '$': 'USD', '£': 'GBP', '₴': 'UAH',
            '₽': 'RUB', '₸': 'KZT', 'zł': 'PLN', '¥': detectedYenOrYuan,
            '₺': 'TRY', 'R$': 'BRL', 'HK$': 'HKD', 'pуб': 'RUB', 'руб': 'RUB',
            'RM': 'MYR', 'CHF': 'CHF', 'NT$': 'TWD'
        };

        const sortedCurrencySymbols = Object.keys(currencyMap).sort((a, b) => b.length - a.length);

        let parsedTransactions = [];
        let foundTransactions = 0;

        rows.forEach((row) => {
            const tds = row.querySelectorAll('td');
            if (tds.length >= 5) {
                const titleText = tds[0].innerText.trim();
                const totalText = tds[1].innerText.trim();
                const sourceText = tds[4].innerText.trim();
                
                if (totalText === "") return; 
                foundTransactions++;
                
                if (sourceText.toLowerCase() !== 'wallet') {
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

                            parsedTransactions.push({ originalText: totalText, title: titleText, source: sourceText, amount: amount, currency: currency, uncertain: uncertain, wasReplaced: false });
                        }
                    }
                }
            }
        });
        
        if (foundTransactions === 0) return { error: "No valid transaction amounts." };
        return { transactions: parsedTransactions, rates: rates, recentActivity: recentActivity };
    } catch (pageError) {
        return { error: pageError.message || String(pageError) };
    }
}
