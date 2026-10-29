// An S3 client configured for Shelby's S3 API.
//
// Copy this file into your project. Everything except the marked settings is a
// standard S3Client, so the rest of your S3 code stays the same.
//
// Docs: https://docs.shelby.xyz/tools/s3-gateway/quickstarts/javascript
import { S3Client } from "@aws-sdk/client-s3";

export const s3 = new S3Client({
  endpoint: process.env.SHELBY_S3_ENDPOINT ?? "https://s3.beta.shelby.xyz",
  // Set the region here: GetBucketLocation can't tell the SDK on Shelby.
  region: "default",
  credentials: {
    // The access key ID starts with SHLB. The secret is the value the console
    // calls your API key. They are two different values.
    accessKeyId: process.env.SHELBY_ACCESS_KEY_ID!,
    secretAccessKey: process.env.SHELBY_SECRET_ACCESS_KEY!,
  },
  // The endpoint doesn't serve bucket names as hostnames.
  forcePathStyle: true,
  // Optional: skips CRC checksums that Shelby accepts but doesn't verify.
  requestChecksumCalculation: "WHEN_REQUIRED",
});

// Your one bucket. You can't create, delete or rename buckets on Shelby.
export const Bucket = process.env.SHELBY_BUCKET!;
