/**
 * Image Upload Service - handles uploading images to ImageKit.io
 */

const { IMAGE_ENABLED } = require("../src/utils/imageSettings");

class ImageUploadService {
  constructor() {
    this.imagekit = null;
    if (IMAGE_ENABLED) {
      const ImageKit = require("@imagekit/nodejs");
      this.imagekit = new ImageKit({
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
        privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      });
    }
  }

  /**
   * Upload an image buffer to ImageKit.io
   * @param {Buffer} imageBuffer - The image buffer to upload
   * @param {string} filename - The filename for the upload
   * @returns {Promise<{url: string, fileId: string}>} - The public URL and file ID
   */
  async uploadImage(imageBuffer, filename) {
    try {
      if (!this.imagekit) throw new Error("Image uploads are disabled");
      console.log(`📤 Uploading image to ImageKit.io: ${filename} (${imageBuffer.length} bytes)`);
      
      // Convert buffer to base64 data URL
      const base64Data = imageBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64Data}`;
      
      const uploadResponse = await this.imagekit.files.upload({
        file: dataUrl,
        fileName: filename,
        folder: "/bingo-leaderboard",
      });

      console.log(`✅ Image uploaded successfully: ${uploadResponse.url}`);
      console.log(`   File ID: ${uploadResponse.fileId}`);
      
      return { url: uploadResponse.url, fileId: uploadResponse.fileId };
    } catch (error) {
      console.error("❌ Error uploading image to ImageKit.io:", error);
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  /**
   * Delete an image from ImageKit.io by file ID
   * @param {string} fileId - The file ID to delete
   * @returns {Promise<boolean>} - Success status
   */
  async deleteImage(fileId) {
    try {
      console.log(`🗑️ Deleting image from ImageKit.io: ${fileId}`);
      
      await this.imagekit.files.delete(fileId);
      
      console.log(`✅ Image deleted successfully: ${fileId}`);
      return true;
    } catch (error) {
      console.error("❌ Error deleting image from ImageKit.io:", error);
      return false;
    }
  }
}

module.exports = ImageUploadService;
