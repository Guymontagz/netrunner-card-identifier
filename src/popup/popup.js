const REPO_URL = "https://github.com/Guymontagz/netrunner-card-identifier";

document.getElementById("about-link").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: REPO_URL });
});
