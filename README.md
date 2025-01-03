# Zotero 7 Datalab

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

This is an plugin for Zotero 7 that converts PDFs to Markdown using Datalab.to

## Quick Start Guide

### Install

- Download the latest release (.xpi file) from the Releases Page Note If you're using Firefox as your browser, right click the xpi and select "Save As.."
- In Zotero click "Tools" in the top menu bar and then click "Plugins     "
- On the "Manage Your Plugins" page, click the gear icon in the top right.
- Select Install Plugin from file.
- Browse to where you downloaded the .xpi file and select it.
- Done!

### Usage

Once you have the plugin installed, right click any item in your collections.  
There will now be a new context menu option titled "Convert to Markdown" 

Once you click this, the PDF will be uploaded to Datalab, converted to Markdown and attached to the item

### Settings

In Zotero Settings there is a Datalab Settings pane that will allow you to set your API key.


## Development

- `nix develop`
- `npm install`
- `npm start`

## Build

- `npm run build`