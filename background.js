chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "checkGoogleConversion") {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(request.query)}`;

        // Open Google silently in the background
        chrome.tabs.create({ url: searchUrl, active: false }, (tab) => {
            const tabId = tab.id;
            
            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    
                    // Inject the parser script into the Google tab
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: parseGoogleCurrency
                    }).then((results) => {
                        
                        if (results && results[0] && results[0].result) {
                            // SUCCESS: Close the background tab and send the result
                            chrome.tabs.remove(tabId);
                            sendResponse({ success: true, value: results[0].result });
                        } else {
                            // FAIL: Keep the tab OPEN and send the tabId back to the popup!
                            sendResponse({ success: false, tabId: tabId });
                        }
                    }).catch(err => {
                        // Error fallback: keep tab open
                        sendResponse({ success: false, tabId: tabId });
                    });
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        
        return true; 
    }
});

function parseGoogleCurrency() {
    return new Promise((resolve) => {
        setTimeout(() => {
            const inputs = document.querySelectorAll('input[type="number"]');
            if (inputs.length >= 2 && inputs[1].value) {
                resolve(inputs[1].value);
                return;
            }
            const resultDiv = document.querySelector('.DFlfde.SwHCTb');
            if (resultDiv) {
                resolve(resultDiv.getAttribute('data-value') || resultDiv.innerText);
                return;
            }
            resolve(null);
        }, 1000); 
    });
}