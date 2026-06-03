export const getDefaultTemplate = (content: string): string =>
  `<!DOCTYPE html>
<html>

<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1" />
  <base target="_blank" />

  <style>
    body {
      background-color: #F6F9FF;
      font-family: "Poppins", "Helvetica Neue", "Segoe UI", Helvetica,
        sans-serif;
      font-size: 15px;
      font-weight: 400;
      line-height: 26px;
      margin: 0;
    }

    pre {
      background: #f4f4f4;
      padding: 2px;
    }

    hr {
      border-top: 1px dashed #94a3b8;
      margin-top: 1rem;
      margin-bottom: 1rem;
    }

    table {
      width: 100%;
    }

    table td {
      padding: 5px 10px 0px;
      vertical-align: middle;
    }

    .socialicons {
      background-color: #fff;
      border-radius: 5px;
      padding: 5px;
      width: initial;
      margin: 0 auto;
      max-width: 200px;
    }

    .brandcolor {
      color: #00c4b8;
    }

    .tooltip {
      background-color: #f1f5f9;
      padding: 1rem;
      border-radius: 1rem;
      color: #475569;
      margin-top: 15px;
      margin-bottom: 15px;
    }

    .tooltip a {
      color: #1e293b;
    }

    .button {
      margin-top: 12px;
      background: #0233BD;
      border-radius: 8px;
      text-decoration: none !important;
      color: #fff !important;
      font-weight: 500;
      padding: 10px 30px;
      display: inline-block;
      font-size: 0.9em;
    }

    .button:hover {
      background: #0233BD;
    }

    .footer {
      text-align: center;
      font-size: 12px;
      color: #cbd5e1;
    }

    .footer a {
      color: #cbd5e1;
    }

    .gutter {
      padding: 5px 30px;
      text-align: center;
      background-color: #fff;
      border-bottom: 1px solid rgb(221, 208, 208);
      max-width: 525px;
      margin: 0 auto;
    }

    img {
      max-width: 100%;
      height: auto;
    }

    .gutter img {
      max-width: 280px;
    }

    h1,
    h2,
    h3,
    h4 {
      font-weight: 600;
    }

    @media screen and (max-width: 600px) {
      .wrap {
        max-width: auto;
      }

      .gutter {
        padding: 10px;
      }
    }
  </style>
</head>

<body style="
      background-color: #F6F9FF;
      font-family: 'Poppins', 'Helvetica Neue', 'Segoe UI', Helvetica,
        sans-serif;
      font-size: 15px;
      line-height: 26px;
      padding: 20px 0;
      margin: 0;
      color: #1e293b;
    ">
  <div class="wrap" style="
        background-color: #fff;
        padding: 40px 30px;
        max-width: 525px;
        margin: 0 auto;
      ">
    ${content}
  </div>

  <div class="footer" style="
    text-align: center;
    font-size: 12px;
    color: #fff;
    padding: 24px 30px;
    background-color: #0542CC;
    max-width: 525px;
    margin: 0 auto;">
    <p style="line-height: initial; margin: 0;">
      ${process.env.EMAIL_BRAND_NAME?.trim() || 'Egea Consultoria'} ${new Date().getFullYear()}
    </p>
  </div>
</body>

</html>
`;
