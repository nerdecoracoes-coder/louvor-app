// Assinatura AWS SigV4 conferida com os exemplos oficiais da documentação do Amazon S3
// (as mesmas regras valem para o Cloudflare R2, que usa a região "auto").
import { describe, expect, test } from "bun:test";
import { presignGet, signHeaders } from "../supabase/functions/_shared/r2.ts";

const cfg = { endpoint: "https://examplebucket.s3.amazonaws.com", bucket: "examplebucket", accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
const when = new Date("2013-05-24T00:00:00Z");

describe("SigV4", () => {
  test("link pré-assinado (exemplo da AWS: GET /test.txt, 86400 s)", async () => {
    const url = await presignGet(cfg, "test.txt", 86400, when, { host: "examplebucket.s3.amazonaws.com", path: "/test.txt" });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
  test("pedido com cabeçalhos (exemplo da AWS: GET /test.txt com Range)", async () => {
    const h = await signHeaders(cfg, "GET", "test.txt", { range: "bytes=0-9" }, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", when,
      { host: "examplebucket.s3.amazonaws.com", path: "/test.txt" });
    expect(h.Authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
});
