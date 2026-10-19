// Klik na ikonu rozšíření otevře aplikaci v nové kartě.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('src/app.html') }));
