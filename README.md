# Master of Puppets

A five-minute, single-player final boss encounter in a haunted theatre, made by Cristian Salinas (CaBs) for Game Over 2026. Choose Cardsharp, Mage or Archer and cut the Puppeteer's strings across four acts.

[Play in Decentraland Explorer](https://decentraland.org/jump?realm=brownsstudio.dcl.eth) · [License](LICENSE) · [Credits](CREDITS.md)

## Build and preview

Use Node.js 24 LTS and npm 11. The repository includes the Decentraland SDK7 source, scene metadata and runtime assets for the published encounter.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run start
```

## Published version

- World: `brownsstudio.dcl.eth`
- Scene entity: `bafkreietg243lgcjg4qfbgxnmuwmutlldykfcltocixk3cbg6e3int2hn4`
- Rebuilt `bin/index.js` CID: `bafybeiea7a5l3dqehq5rgtthgis2onpl46malq7nqdw4b6jcekfgln64ia`
