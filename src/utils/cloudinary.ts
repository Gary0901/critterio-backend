import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadImage(
  buffer: Buffer,
  folder: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Upload failed'));
        resolve(result.secure_url);
      }
    ).end(buffer);
  });
}

// 從 Cloudinary secure_url 還原 public_id 並刪除該圖片
export async function deleteImageByUrl(url: string): Promise<void> {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  if (!match) return;
  await cloudinary.uploader.destroy(match[1]);
}
