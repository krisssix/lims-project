export default class ApiError {
  constructor(statusCode, message, response) {
    this.statusCode = statusCode;
    this.message = message;
    this.response = response;
  }
}
