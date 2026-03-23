# Webhooks CodeRise — Nuvemshop ↔ Suri

## Arquitetura do fluxo

```
NUVEMSHOP  ──────────────────────────────→  SURI
 Produto criado/atualizado/deletado          Espelha produto + estoque
 Pedido criado/pago                          Cria pedido na Suri
 Pedido enviado                              Atualiza logística
 Pedido cancelado                            Cancela pedido

SURI  ───────────────────────────────────→  NUVEMSHOP
 Compra realizada na Suri                    Deduz estoque da variante
```

> ⚠️ Regra principal: O controle de produtos e estoque é SEMPRE da Nuvemshop.
> A Suri nunca cria, edita ou controla produtos diretamente.
> Quando uma venda ocorre na Suri, o CodeRise deduz o estoque na Nuvemshop.

---

## FLUXO DIRETO — Nuvemshop → Suri

> Token: webhook_token (GET /integrations)
> URL: POST https://app-coderise.vercel.app/webhook?token=WEBHOOK_TOKEN
> Header: Content-Type: application/json

---

### PRODUTOS

---

#### 1. Criar produto — products/created

```json
{
  "topic": "products/created",
  "product": {
    "id": 999010,
    "name": { "pt": "Camiseta Básica Branca" },
    "description": { "pt": "Camiseta básica 100% algodão" },
    "published_at": "2026-03-22T00:00:00-03:00",
    "brand": null,
    "canonical_url": null,
    "categories": [{ "id": "141301160" }],
    "images": [],
    "variants": [
      {
        "id": 1,
        "sku": "CAM-BASIC-001",
        "price": "59.90",
        "promotional_price": "0.00",
        "weight": "0",
        "width": "0",
        "height": "0",
        "depth": "0",
        "stock": 50,
        "values": {}
      }
    ]
  }
}
```
Resultado: produto criado na Suri com stocks: { "141301072": { "stock": 50 } }

---

#### 2. Atualizar produto / estoque — products/updated

```json
{
  "topic": "products/updated",
  "product": {
    "id": 999010,
    "name": { "pt": "Camiseta Básica Branca" },
    "description": { "pt": "Camiseta básica 100% algodão — edição limitada" },
    "published_at": "2026-03-22T00:00:00-03:00",
    "brand": null,
    "canonical_url": null,
    "categories": [{ "id": "141301160" }],
    "images": [],
    "variants": [
      {
        "id": 1,
        "sku": "CAM-BASIC-001",
        "price": "69.90",
        "promotional_price": "59.90",
        "weight": "0",
        "width": "0",
        "height": "0",
        "depth": "0",
        "stock": 75,
        "values": {}
      }
    ]
  }
}
```
Resultado: produto atualizado na Suri — preço, descrição e estoque sincronizados.
Também use este mesmo topic para atualizar APENAS o estoque (altere só o campo stock).

---

#### 3. Produto com múltiplas variantes — products/created

```json
{
  "topic": "products/created",
  "product": {
    "id": 999011,
    "name": { "pt": "Camiseta com Tamanhos" },
    "description": { "pt": "Disponível nos tamanhos P, M e G" },
    "published_at": "2026-03-22T00:00:00-03:00",
    "brand": null,
    "canonical_url": null,
    "categories": [{ "id": "141301160" }],
    "images": [],
    "variants": [
      {
        "id": 101,
        "sku": "CAM-TAM-P",
        "price": "59.90",
        "promotional_price": "0.00",
        "weight": "0.300",
        "width": "30",
        "height": "5",
        "depth": "40",
        "stock": 20,
        "values": { "Tamanho": "P" }
      },
      {
        "id": 102,
        "sku": "CAM-TAM-M",
        "price": "59.90",
        "promotional_price": "0.00",
        "weight": "0.300",
        "width": "30",
        "height": "5",
        "depth": "40",
        "stock": 35,
        "values": { "Tamanho": "M" }
      },
      {
        "id": 103,
        "sku": "CAM-TAM-G",
        "price": "59.90",
        "promotional_price": "0.00",
        "weight": "0.300",
        "width": "30",
        "height": "5",
        "depth": "40",
        "stock": 15,
        "values": { "Tamanho": "G" }
      }
    ]
  }
}
```
Resultado: produto criado na Suri com 3 dimensões, cada uma com SKU e estoque próprio.

---

#### 4. Deletar / desativar produto — products/deleted

```json
{
  "topic": "products/deleted",
  "product": {
    "id": 999010
  }
}
```
Resultado: produto marcado como isActive: false na Suri.

---

### PEDIDOS

---

#### 5. Pedido criado — orders/created

```json
{
  "topic": "orders/created",
  "order": {
    "id": 8001,
    "number": 8001,
    "status": "open",
    "payment_status": "paid",
    "shipping_status": "unpacked",
    "payment_details": { "method": "credit_card" },
    "total": "129.90",
    "shipping_cost_owner": "15.00",
    "shipping_pickup_type": "ship",
    "products": [
      {
        "product_id": 999010,
        "variant_id": 1,
        "sku": "CAM-BASIC-001",
        "name": "Camiseta Básica Branca",
        "quantity": 2,
        "price": "59.90",
        "discount": "0.00"
      }
    ]
  }
}
```
Resultado: pedido criado e pago na Suri.

---

#### 6. Pedido pago — orders/paid

```json
{
  "topic": "orders/paid",
  "order": {
    "id": 8002,
    "number": 8002,
    "status": "open",
    "payment_status": "paid",
    "shipping_status": "unpacked",
    "payment_details": { "method": "pix" },
    "total": "59.90",
    "shipping_cost_owner": "10.00",
    "shipping_pickup_type": "ship",
    "products": [
      {
        "product_id": 999010,
        "variant_id": 1,
        "sku": "CAM-BASIC-001",
        "name": "Camiseta Básica Branca",
        "quantity": 1,
        "price": "59.90",
        "discount": "0.00"
      }
    ]
  }
}
```
Resultado: mesmo fluxo de orders/created — pedido criado e pago na Suri.

---

#### 7. Pedido enviado — orders/fulfilled

```json
{
  "topic": "orders/fulfilled",
  "order": {
    "id": 8001,
    "number": 8001,
    "status": "closed",
    "shipping_status": "shipped"
  }
}
```
Resultado: status logístico atualizado para enviado (status 3) na Suri.

---

#### 8. Pedido parcialmente enviado — orders/partially_fulfilled

```json
{
  "topic": "orders/partially_fulfilled",
  "order": {
    "id": 8001,
    "number": 8001,
    "status": "open",
    "shipping_status": "partially_shipped"
  }
}
```
Resultado: status logístico parcial (status 3) atualizado na Suri.

---

#### 9. Pedido cancelado — orders/cancelled

```json
{
  "topic": "orders/cancelled",
  "order": {
    "id": 8001,
    "number": 8001,
    "status": "cancelled",
    "shipping_status": "unpacked"
  }
}
```
Resultado: pedido cancelado na Suri.

---

## FLUXO REVERSO — Suri → Nuvemshop

> Token: chatbot_token (GET /chatbot)
> URL: POST https://app-coderise.vercel.app/webhook?token=CHATBOT_TOKEN
> Header: Content-Type: application/json

> Este é o ÚNICO fluxo onde a Suri comunica algo à Nuvemshop.
> A Suri não controla produtos — apenas vende.
> Quando uma venda ocorre na Suri, o CodeRise deduz o estoque na Nuvemshop.
> O estoque na Nuvemshop é sempre a fonte da verdade.

---

#### 10. Compra realizada na Suri → deduz estoque na Nuvemshop — order.created

```json
{
  "type": "order.created",
  "orderId": "8003",
  "items": [
    {
      "productId": "999010",
      "sku": "CAM-BASIC-001",
      "quantity": 2
    }
  ]
}
```
Resultado: estoque da variante CAM-BASIC-001 reduzido em 2 unidades na Nuvemshop.

---

#### 11. Compra de múltiplos produtos na Suri — order.created

```json
{
  "type": "order.created",
  "orderId": "8004",
  "items": [
    {
      "productId": "999010",
      "sku": "CAM-BASIC-001",
      "quantity": 1
    },
    {
      "productId": "999011",
      "sku": "CAM-TAM-M",
      "quantity": 3
    }
  ]
}
```
Resultado: estoque deduzido em cada variante separadamente na Nuvemshop.

---

#### 12. Pedido enviado na Suri → atualiza Nuvemshop — order.shipped

```json
{
  "type": "order.shipped",
  "orderId": "8001",
  "tracking_number": "BR123456789",
  "tracking_url": "https://rastreamento.correios.com.br/objeto/BR123456789",
  "notify_customer": true
}
```
Resultado: pedido marcado como enviado na Nuvemshop com código de rastreio.

---

#### 13. Pedido cancelado na Suri → cancela na Nuvemshop — order.cancelled

```json
{
  "type": "order.cancelled",
  "orderId": "8001"
}
```
Resultado: pedido cancelado na Nuvemshop.

---

## Tabela resumo

### Fluxo Direto — Nuvemshop → Suri (webhook_token)
> Nuvemshop é a fonte da verdade para produtos e estoque.

| Topic Nuvemshop              | Ação na Suri                              |
|------------------------------|-------------------------------------------|
| products/created             | Cria produto com estoque                  |
| products/updated             | Atualiza produto, preço e estoque         |
| products/deleted             | Desativa produto (isActive: false)        |
| orders/created               | Cria pedido + marca como pago             |
| orders/paid                  | Cria pedido + marca como pago             |
| orders/fulfilled             | Atualiza logística → enviado (status 3)   |
| orders/partially_fulfilled   | Atualiza logística → parcial (status 3)   |
| orders/cancelled             | Cancela pedido                            |

### Fluxo Reverso — Suri → Nuvemshop (chatbot_token)
> A Suri só comunica eventos de venda — nunca altera produtos diretamente.

| Evento Suri      | Ação na Nuvemshop                          |
|------------------|--------------------------------------------|
| order.created    | Deduz estoque das variantes compradas      |
| order.shipped    | Marca pedido como enviado + rastreio       |
| order.cancelled  | Cancela pedido                             |

