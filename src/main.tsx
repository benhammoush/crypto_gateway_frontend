/**
 * Browser application mounting at the HTML entry boundary.
 * @packageDocumentation
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AntApp, ConfigProvider, theme } from './design-system';
import './style.css';

const antTokens = theme.getDesignToken();
const checkoutTokens = {
  motion: false,
  colorBgLayout: '#f5f7fa',
  borderRadiusLG: 10,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        cssVar: { key: 'checkout' },
        token: checkoutTokens,
        components: {
          Card: {
            headerBg: antTokens.colorBgContainer,
            colorTextHeading: antTokens.colorText,
          },
        },
      }}
    >
      <AntApp style={{ backgroundColor: checkoutTokens.colorBgLayout }}>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
