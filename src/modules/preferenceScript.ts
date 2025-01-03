import { config } from "../../package.json";
import { getString } from "../utils/locale";

interface PrefsData {
  window: Window;
  columns: Array<{
    dataKey: string;
    label: string;
    fixedWidth?: boolean;
    width?: number;
  }>;
  rows: Array<{ [dataKey: string]: string }>;
}

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [], // Empty columns since we don't use the table
      rows: []     // Empty rows since we don't use the table
    } as PrefsData;
  } else {
    addon.data.prefs.window = _window;
  }
  updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  if (!addon.data.prefs?.window) return;
  
  // Get the current API key value
  const apiKeyPref = `extensions.zotero.${config.addonRef}.apikey`;
  const currentApiKey = (Zotero.Prefs.get(apiKeyPref) as string) || "";
  
  // Set the API key input value
  const apiKeyInput = addon.data.prefs.window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-apikey`
  ) as HTMLInputElement;
  
  if (apiKeyInput) {
    apiKeyInput.value = currentApiKey;
  }

  // Get and set the current download images value
  const downloadImagesPref = `extensions.zotero.${config.addonRef}.downloadImages`;
  const currentDownloadImages = Zotero.Prefs.get(downloadImagesPref);
  ztoolkit.log(`Initial download images value: ${currentDownloadImages} (type: ${typeof currentDownloadImages})`);
  
  const downloadImagesCheckbox = addon.data.prefs.window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-download-images`
  ) as HTMLInputElement;
  
  if (downloadImagesCheckbox) {
    downloadImagesCheckbox.checked = currentDownloadImages === true;
    ztoolkit.log(`Set checkbox checked state to: ${downloadImagesCheckbox.checked}`);
  }
}

function bindPrefEvents() {
  if (!addon.data.prefs?.window) return;

  // Bind API key input
  const apiKeyPref = `extensions.zotero.${config.addonRef}.apikey`;
  const apiKeyInput = addon.data.prefs.window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-apikey`
  ) as HTMLInputElement;

  if (apiKeyInput) {
    apiKeyInput.addEventListener("change", (e) => {
      const value = (e.target as HTMLInputElement).value;
      Zotero.Prefs.set(apiKeyPref, value);
      ztoolkit.log(`Updated API key`);
    });
  }

  // Bind download images checkbox
  const downloadImagesPref = `extensions.zotero.${config.addonRef}.downloadImages`;
  const downloadImagesCheckbox = addon.data.prefs.window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-download-images`
  ) as HTMLInputElement;

  if (downloadImagesCheckbox) {
    downloadImagesCheckbox.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      Zotero.Prefs.set(downloadImagesPref, checked);
      ztoolkit.log(`Updated download images preference to: ${checked} (type: ${typeof checked})`);
    });
  }
}
