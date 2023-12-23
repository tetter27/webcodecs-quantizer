# webcodecs-quantizer

https://tetter27.github.io/webcodecs-quantizer/

## Overview
![](/img/app_ui.gif)

以下のモードを選択してビットレート推移を確認できます。
- ビットレート変動
  - "quantizer"
  - "constant"
- QP 固定 (指定して変動も可)

ビットレート変動を選択した場合、ビットレートの変化シナリオは以下から選択できます。
- Scenario 1: 急激に減少・増加させる
- Scenario 2: 緩やかに増加させ、急激に減少させる
- Customized: ユーザが制御する

## Environment
- Chrome 117 以上
- M1 Mac では AVC 使用不可

## Reference
- https://docs.google.com/presentation/d/1FpCAlxvRuC0e52JrthMkx-ILklB5eHszbk8D3FIuSZ0/edit?usp=sharing