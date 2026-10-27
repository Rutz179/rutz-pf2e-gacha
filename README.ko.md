# Rutz's PF2e Gacha

[디스코드](https://discord.gg/pnVW5QmXKx) · [위키](https://github.com/Rutz179/rutz-pf2e-gacha/wiki/한국어-안내) · [English](README.md)

Foundry VTT용 **패스파인더 2판** 보상 기계입니다. 밤 휴식(Rest for the Night) 뒤 캐릭터마다 판정을 굴리고, 성공하면 야영지에서 찾은 물건을 뽑는 보물 룰렛이 열립니다. 대부분 음식·장비·물약이고, 가끔 특별한 것이 나옵니다. 돈을 내고 다시 돌리고, 마음에 드는 걸 받고, 테이블 모두가 함께 봅니다.

<img src="media/EN_05.png" alt="돌린 뒤의 보물 룰렛 — 나온 물건과 받기 버튼" width="760">

## 할 수 있는 것
- **휴식 뒤 기회** — PF2e의 밤 휴식이 끝나면 쉰 캐릭터 모두를 위한 카드가 채팅에 하나 올라옵니다. 캐릭터마다 레벨 기준 DC로 생존 판정. 대성공이면 한 번 더 무료로 돌립니다.
- **보물 룰렛** — 일반부터 전설까지 5등급. 다시 돌리기는 돈이 들고(레벨에 맞춰, 최대 3번), 나온 것 중 아무거나 받거나 그 값어치를 현금으로 받습니다.
- **모두가 함께** — 돌리는 모습이 모두의 화면에 한 명씩, 누구 차례인지와 함께 나옵니다. 여럿이 기회를 받으면 줄을 섭니다.
- **GM** — 토큰 도구에서 언제든 기회를 주고, 판정 기술과 DC를 정합니다.
- 직접 멈추는 **777 슬롯**, 진짜 카드 한 벌로 더블업하는 **하이 & 로우**, 전투 뒤 **전리품**, 등급마다 **품목 표 편집**, 다시 돌리기 비용·받기 규칙.

<img src="media/EN_06.png" alt="777 슬롯" height="300"> <img src="media/EN_07.png" alt="고급 판돈이 걸린 하이 & 로우" height="300">

## 설치
Foundry → *Add-on Modules* → *Install Module* → Manifest URL:
```
https://github.com/Rutz179/rutz-pf2e-gacha/releases/latest/download/module.json
```
Foundry VTT v13–v14 · 패스파인더 2판 시스템 · 한국어 / English (Foundry 언어 설정을 따름)

## 빠른 시작
1. PF2e 월드에서 모듈을 켭니다.
2. 밤 휴식을 하면 채팅에 **주변을 뒤져 보기** 카드가 올라옵니다. 플레이어마다 **뒤져 보기**를 누릅니다.
3. 성공하면 룰렛이 열립니다: **SPIN**, 원하면 다시 돌리고, **받기**.
4. GM: 토큰 도구의 🎁 버튼으로 언제든 기회를 줍니다.

전체 안내: **[위키](https://github.com/Rutz179/rutz-pf2e-gacha/wiki/한국어-안내)** · 매크로: `game.rutzGacha.offer(actors)`

질문·버그 제보: [Issues](https://github.com/Rutz179/rutz-pf2e-gacha/issues) 또는 [디스코드](https://discord.gg/pnVW5QmXKx).
