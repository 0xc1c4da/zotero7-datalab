import { getString } from "../utils/locale";
import { config } from "../../package.json";

interface DatalabResponse {
  success: boolean;
  error?: string;
  request_id: string;
  request_check_url: string;
}

interface DatalabStatusResponse {
  status: 'complete' | 'processing';
  success: boolean;
  error?: string;
  markdown: string;
  images?: { [key: string]: string };
}

interface QueueItem {
  id: string;
  item: Zotero.Item;
  status: 'queued' | 'uploading' | 'processing' | 'downloading' | 'complete' | 'error';
  requestId?: string;
  checkUrl?: string;
  error?: string;
}

export class DatalabManager {
  private static _instance: DatalabManager;
  private _queue: Map<string, QueueItem> = new Map();
  private _pollingInterval: number = 2000; // 2 seconds
  private _maxPolls: number = 300; // 10 minutes max
  private _apiUrl: string = "https://www.datalab.to/api/v1/marker";

  private constructor() {
    // Private constructor to force singleton
  }

  public static getInstance(): DatalabManager {
    if (!DatalabManager._instance) {
      DatalabManager._instance = new DatalabManager();
    }
    return DatalabManager._instance;
  }

  public registerRightClickMenuItem() {
    const menuIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-itemmenu-datalab-convert",
      label: getString("menuitem-convert-to-markdown"),
      commandListener: (ev) => this.convertSelectedItems(),
      icon: menuIcon,
    });
  }

  private async convertSelectedItems() {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    if (!items.length) {
      this.showProgressWindow("No items selected", "fail");
      return;
    }

    const apiKey = Zotero.Prefs.get(`extensions.zotero.${config.addonRef}.apikey`) as string;
    if (!apiKey) {
      this.showProgressWindow("Datalab API key not set. Please set it in preferences.", "fail");
      return;
    }

    const progressWin = new ztoolkit.ProgressWindow("Datalab Conversion");
    const progressLines: { [key: string]: any } = {};

    // Create progress lines for each item
    items.forEach((item) => {
      const title = item.getField('title') as string;
      const queueItem: QueueItem = {
        id: `${item.id}-${Date.now()}`,
        item: item,
        status: 'queued'
      };
      this._queue.set(queueItem.id, queueItem);

      progressLines[queueItem.id] = progressWin.createLine({
        text: `Queued: ${title}`,
        type: "default",
      });
    });
    progressWin.show();

    // Process items in parallel since we have proper queue management
    const promises = Array.from(this._queue.values())
      .filter(item => item.status === 'queued')
      .map(item => this.processQueueItem(item, progressLines[item.id], apiKey));

    await Promise.allSettled(promises);
  }

  private async processQueueItem(queueItem: QueueItem, progressLine: any, apiKey: string): Promise<void> {
    try {
      const attachments = await queueItem.item.getAttachments();
      const pdfAttachment = attachments.find(async (attachmentId) => {
        const attachment = await Zotero.Items.get(attachmentId);
        return attachment.attachmentContentType === 'application/pdf';
      });

      if (!pdfAttachment) {
        progressLine.changeLine({
          text: `No PDF found for "${queueItem.item.getField('title')}"`,
          type: "fail",
        });
        queueItem.status = 'error';
        queueItem.error = 'No PDF attachment found';
        return;
      }

      // Update status and progress
      queueItem.status = 'uploading';
      progressLine.changeLine({
        text: `Uploading PDF for "${queueItem.item.getField('title')}"...`,
        type: "default",
      });

      // Get the PDF file path
      const attachment = await Zotero.Items.get(pdfAttachment);
      const pdfPath = await attachment.getFilePathAsync();
      if (!pdfPath) throw new Error('PDF file not found');

      // Read file as array buffer
      const fileData = await IOUtils.read(pdfPath);
      
      // Create form data boundary
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      
      // Create form data parts
      const encoder = new TextEncoder();
      
      // Start boundary and file headers
      const fileHeader = encoder.encode([
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="file"; filename="document.pdf"\r\n',
        'Content-Type: application/pdf\r\n\r\n'
      ].join(''));
      
      // End boundary and output format
      const formEnd = encoder.encode([
        '\r\n',
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="output_format"\r\n\r\n',
        'markdown\r\n',
          `--${boundary}--\r\n`
      ].join(''));
      
      // Combine all parts into a single Uint8Array
      const totalLength = fileHeader.length + fileData.length + formEnd.length;
      const formData = new Uint8Array(totalLength);
      formData.set(fileHeader, 0);
      formData.set(fileData, fileHeader.length);
      formData.set(formEnd, fileHeader.length + fileData.length);
      
      // Make request using XMLHttpRequest which can handle binary data
      const response = await new Promise<{status: number; response: string}>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', this._apiUrl);
        xhr.setRequestHeader('X-Api-Key', apiKey);
        xhr.setRequestHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
        
        xhr.onload = () => {
          resolve({
            status: xhr.status,
            response: xhr.responseText
          });
        };
        
        xhr.onerror = () => {
          reject(new Error('Network request failed'));
        };
        
        xhr.send(formData);
      });

      if (response.status !== 200) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const data = JSON.parse(response.response) as unknown as DatalabResponse;
      if (!data.success) {
        throw new Error(data.error || 'Upload failed');
      }

      queueItem.status = 'processing';
      queueItem.requestId = data.request_id;
      queueItem.checkUrl = data.request_check_url;

      progressLine.changeLine({
        text: `Processing PDF for "${queueItem.item.getField('title')}"...`,
        type: "default",
      });

      // Start polling for results
      await this.pollForResults(queueItem, progressLine);

    } catch (error: any) {
      progressLine.changeLine({
        text: `Error processing "${queueItem.item.getField('title')}": ${error.message}`,
        type: "fail",
      });
      queueItem.status = 'error';
      queueItem.error = error.message;
    }
  }

  private async pollForResults(queueItem: QueueItem, progressLine: any): Promise<void> {
    const apiKey = Zotero.Prefs.get(`extensions.zotero.${config.addonRef}.apikey`) as string;
    
    for (let i = 0; i < this._maxPolls; i++) {
      try {
        const response = await new Promise<{status: number; response: string}>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', queueItem.checkUrl!);
          xhr.setRequestHeader('X-Api-Key', apiKey);
          
          xhr.onload = () => {
            resolve({
              status: xhr.status,
              response: xhr.responseText
            });
          };
          
          xhr.onerror = () => {
            reject(new Error('Network request failed'));
          };
          
          xhr.send();
        });

        if (response.status !== 200) {
          throw new Error(`Polling failed: ${response.status}`);
        }

        const data = JSON.parse(response.response) as unknown as DatalabStatusResponse;
        
        if (data.status === 'complete') {
          if (!data.success) {
            throw new Error(data.error || 'Conversion failed');
          }

          // Download complete, save markdown
          queueItem.status = 'downloading';
          progressLine.changeLine({
            text: `Saving markdown for "${queueItem.item.getField('title')}"...`,
            type: "default",
          });

          await this.saveMarkdownAndImages(queueItem, data);

          queueItem.status = 'complete';
          progressLine.changeLine({
            text: `Completed conversion for "${queueItem.item.getField('title')}"`,
            type: "success",
          });
          break;
        }

        // Still processing, wait before next poll
        await Zotero.Promise.delay(this._pollingInterval);

      } catch (error: any) {
        progressLine.changeLine({
          text: `Error checking status for "${queueItem.item.getField('title')}": ${error.message}`,
          type: "fail",
        });
        queueItem.status = 'error';
        queueItem.error = error.message;
        break;
      }
    }

    if (queueItem.status === 'processing') {
      progressLine.changeLine({
        text: `Timeout waiting for conversion of "${queueItem.item.getField('title')}"`,
        type: "fail",
      });
      queueItem.status = 'error';
      queueItem.error = 'Conversion timeout';
    }
  }

  private async saveMarkdownAndImages(queueItem: QueueItem, data: any): Promise<void> {
    // Save markdown file
    const tmpDir = await Zotero.getTempDirectory();
    const title = queueItem.item.getField('title');
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    // Save markdown
    const mdPath = `${tmpDir.path}/${safeTitle}.md`;
    await IOUtils.writeUTF8(mdPath, data.markdown);
    
    // Attach markdown to item
    await Zotero.Attachments.importFromFile({
      file: mdPath,
      parentItemID: queueItem.item.id,
      contentType: 'text/markdown',
      title: `${title}.md`
    });

    // Save and attach images if enabled and available
    const downloadImages = Zotero.Prefs.get(`extensions.zotero.${config.addonRef}.downloadImages`);
    ztoolkit.log(`Download images preference value: ${downloadImages}`);
    ztoolkit.log(`Download images preference type: ${typeof downloadImages}`);
    if (downloadImages && data.images) {
      for (const [filename, base64Data] of Object.entries(data.images)) {
        const imgPath = `${tmpDir.path}/${filename}`;
        const imgData = Uint8Array.from(atob(base64Data as string), c => c.charCodeAt(0));
        await IOUtils.write(imgPath, imgData);

        await Zotero.Attachments.importFromFile({
          file: imgPath,
          parentItemID: queueItem.item.id,
          contentType: this.getImageMimeType(filename),
          title: filename
        });
      }
    }
  }

  private getImageMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      default: return 'application/octet-stream';
    }
  }

  private showProgressWindow(message: string, type: "success" | "fail" | "default" = "default") {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: message,
        type: type,
      })
      .show();
  }

  public registerPrefs() {
   // Initialize preferences if not set
   const apiKeyPref = `extensions.zotero.${config.addonRef}.apikey`;
   const downloadImagesPref = `extensions.zotero.${config.addonRef}.downloadImages`;

   if (!Zotero.Prefs.get(apiKeyPref)) {
     Zotero.Prefs.set(apiKeyPref, "");
   }
   if (Zotero.Prefs.get(downloadImagesPref) === undefined) {
     Zotero.Prefs.set(downloadImagesPref, false);
   }
  }
}
