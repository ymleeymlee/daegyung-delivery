import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // rider-app.json / rider-app.apk 는 배포 시마다 값이 바뀌므로 Vercel edge CDN 캐시 금지.
  // 캐시되면 폰이 인앱 자동 업데이트로 이전 APK 를 받는다.
  async headers() {
    return [
      {
        source: "/rider-app.:ext(json|apk)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
