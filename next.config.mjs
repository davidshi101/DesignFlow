/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow larger JSON bodies for base64 image uploads in the local demo
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
