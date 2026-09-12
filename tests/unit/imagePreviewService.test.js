/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
let dir;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'image-preview-'));});
afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('converts TIFF into a browser preview cache while preserving the source bytes', async()=>{
 const source=path.join(dir,'photo.tiff');
 await sharp({create:{width:5,height:7,channels:3,background:'red'}}).tiff().toFile(source);
 const original=fs.readFileSync(source);
 const service = require('../../src/main/services/ImagePreviewService');
 expect(typeof service.resolveBrowserImage).toBe('function');
 const output=await service.resolveBrowserImage(source,path.join(dir,'cache'));
 expect(output).not.toBe(source);
 expect((await sharp(output).metadata()).format).toBe('png');
 expect(fs.readFileSync(source)).toEqual(original);
 expect(await service.resolveBrowserImage(source,path.join(dir,'cache'))).toBe(output);
});
